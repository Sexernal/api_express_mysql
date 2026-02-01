// controllers/medicalController.js
const db = require('../db');
const fs = require('fs');
const path = require('path');

const uploadsRoot = path.join(__dirname, '..', 'uploads');
const medicalDir = path.join(uploadsRoot, 'medical');

const fileUrlFromFilename = (filename) => {
  if (!filename) return null;
  return `/uploads/medical/${filename}`;
};

// Parse date string coming from input (supports YYYY-MM-DD or full ISO)
function parseDateFromInput(val) {
  if (!val) return new Date();
  // fecha tipo "YYYY-MM-DD" (input type=date)
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
  if (dateOnly.test(val)) {
    const [y, m, d] = val.split('-').map(Number);
    const now = new Date();
    // combinamos la fecha seleccionada con la hora local actual para evitar desplazamiento por zona horaria
    return new Date(y, m - 1, d, now.getHours(), now.getMinutes(), now.getSeconds());
  }
  // otros formatos -> dejar que Date los parsee
  return new Date(val);
}

// Formatea Date a string SQL local "YYYY-MM-DD HH:MM:SS"
function formatDateToSQLLocal(dt) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = dt.getFullYear();
  const mm = pad(dt.getMonth() + 1);
  const dd = pad(dt.getDate());
  const hh = pad(dt.getHours());
  const mi = pad(dt.getMinutes());
  const ss = pad(dt.getSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

// Convierte valor devuelto por la DB (Date object o string "YYYY-MM-DD HH:MM:SS") a Date local
function dateFromDbValue(val) {
  if (!val) return null;
  if (val instanceof Date) return val;
  // formato "YYYY-MM-DD HH:MM:SS"
  const m = val.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (m) {
    const [_, y, mo, d, hh, mm, ss] = m;
    return new Date(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm), Number(ss));
  }
  // fallback
  const parsed = new Date(val);
  return isNaN(parsed.getTime()) ? null : parsed;
}

// Formatea Date a string legible "DD/MM/YYYY, HH:MM:SS"
function formatDisplayDate(dt) {
  if (!dt) return '-';
  const pad = (n) => String(n).padStart(2, '0');
  const dd = pad(dt.getDate());
  const mm = pad(dt.getMonth() + 1);
  const yyyy = dt.getFullYear();
  const hh = pad(dt.getHours());
  const mi = pad(dt.getMinutes());
  const ss = pad(dt.getSeconds());
  return `${dd}/${mm}/${yyyy}, ${hh}:${mi}:${ss}`;
}

const MedicalController = {
  async listByPet(req, res) {
    try {
      const petId = req.query.pet_id || req.query.mascota_id || null;

      let rows;
      if (petId) {
        [rows] = await db.query(
          `SELECT f.*, u.nombre AS creado_por_nombre, m.nombre AS mascota_nombre
           FROM fichas_medicas f
           LEFT JOIN usuarios u ON f.uploaded_by = u.id
           LEFT JOIN mascotas m ON f.mascota_id = m.id
           WHERE f.mascota_id = ?
           ORDER BY f.fecha DESC`,
          [petId]
        );
      } else {
        [rows] = await db.query(
          `SELECT f.*, u.nombre AS creado_por_nombre, m.nombre AS mascota_nombre
           FROM fichas_medicas f
           LEFT JOIN usuarios u ON f.uploaded_by = u.id
           LEFT JOIN mascotas m ON f.mascota_id = m.id
           ORDER BY f.fecha DESC
           LIMIT 200`
        );
      }

      const out = rows.map(r => {
        const fechaDt = dateFromDbValue(r.fecha);
        return {
          ...r,
          filepath: r.filename ? fileUrlFromFilename(r.filename) : null,
          fecha_display: fechaDt ? formatDisplayDate(fechaDt) : '-'
        };
      });

      res.json({ success: true, data: out });
    } catch (err) {
      console.error('Error listByPet:', err);
      res.status(500).json({ success: false, message: 'Error al listar fichas', error: err.message });
    }
  },

  async getById(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query(
        `SELECT f.*, u.nombre AS creado_por_nombre, m.nombre AS mascota_nombre
         FROM fichas_medicas f
         LEFT JOIN usuarios u ON f.uploaded_by = u.id
         LEFT JOIN mascotas m ON f.mascota_id = m.id
         WHERE f.id = ?`,
        [id]
      );
      if (!rows.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
      const r = rows[0];
      const fechaDt = dateFromDbValue(r.fecha);
      r.filepath = r.filename ? fileUrlFromFilename(r.filename) : null;
      r.fecha_display = fechaDt ? formatDisplayDate(fechaDt) : '-';
      res.json({ success: true, data: r });
    } catch (err) {
      console.error('Error getById:', err);
      res.status(500).json({ success: false, message: 'Error al obtener ficha', error: err.message });
    }
  },

  async create(req, res) {
    try {
      const mascotaId = req.body.pet_id || req.body.mascota_id;
      if (!mascotaId) return res.status(400).json({ success: false, message: 'mascota_id (pet_id) requerido' });

      const [mRows] = await db.query('SELECT id FROM mascotas WHERE id = ?', [mascotaId]);
      if (!mRows.length) return res.status(400).json({ success: false, message: 'Mascota no existe' });

      const tipo = req.body.tipo || req.body.tipo_registro || 'consulta';
      const fechaDate = req.body.fecha ? parseDateFromInput(req.body.fecha) : new Date();
      const fechaSql = formatDateToSQLLocal(fechaDate);
      const peso = (typeof req.body.peso !== 'undefined' && req.body.peso !== '') ? req.body.peso : null;
      const nota = req.body.nota || req.body.observaciones || null;

      let filename = null;
      let mime = null;
      let size_bytes = null;

      if (req.file) {
        filename = req.file.filename;
        mime = req.file.mimetype;
        size_bytes = req.file.size;
      }

      const uploaded_by = req.user?.userId || req.user?.id || null;

      const [result] = await db.query(
        `INSERT INTO fichas_medicas
         (mascota_id, tipo, fecha, peso, nota, filename, filepath, mime, size_bytes, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mascotaId,
          tipo,
          fechaSql,
          peso,
          nota,
          filename,
          filename ? fileUrlFromFilename(filename) : null,
          mime,
          size_bytes,
          uploaded_by
        ]
      );

      const [rows] = await db.query(
        `SELECT f.*, u.nombre AS creado_por_nombre, m.nombre AS mascota_nombre
         FROM fichas_medicas f
         LEFT JOIN usuarios u ON f.uploaded_by = u.id
         LEFT JOIN mascotas m ON f.mascota_id = m.id
         WHERE f.id = ?`,
        [result.insertId]
      );

      const inserted = rows[0];
      const fechaDt = dateFromDbValue(inserted.fecha);
      inserted.filepath = inserted.filename ? fileUrlFromFilename(inserted.filename) : null;
      inserted.fecha_display = fechaDt ? formatDisplayDate(fechaDt) : '-';

      res.status(201).json({ success: true, data: inserted });
    } catch (err) {
      console.error('Error create ficha:', err);
      res.status(500).json({ success: false, message: 'Error al crear ficha', error: err.message });
    }
  },

  async update(req, res) {
    try {
      const id = req.params.id;
      const [existingRows] = await db.query('SELECT * FROM fichas_medicas WHERE id = ?', [id]);
      if (!existingRows.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
      const existing = existingRows[0];

      const tipo = req.body.tipo || existing.tipo;
      const fechaDate = req.body.fecha ? parseDateFromInput(req.body.fecha) : dateFromDbValue(existing.fecha) || new Date();
      const fechaSql = formatDateToSQLLocal(fechaDate);
      const peso = (typeof req.body.peso !== 'undefined' && req.body.peso !== '') ? req.body.peso : existing.peso;
      const nota = (typeof req.body.nota !== 'undefined') ? req.body.nota : existing.nota;

      let filename = existing.filename;
      let mime = existing.mime;
      let size_bytes = existing.size_bytes;

      if (req.file) {
        if (existing.filename) {
          const oldPath = path.join(medicalDir, existing.filename);
          try { if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath); } catch (e) { /* no crítico */ }
        }
        filename = req.file.filename;
        mime = req.file.mimetype;
        size_bytes = req.file.size;
      }

      await db.query(
        `UPDATE fichas_medicas
         SET tipo = ?, fecha = ?, peso = ?, nota = ?, filename = ?, filepath = ?, mime = ?, size_bytes = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [tipo, fechaSql, peso, nota, filename, filename ? fileUrlFromFilename(filename) : null, mime, size_bytes, id]
      );

      const [rows] = await db.query(
        `SELECT f.*, u.nombre AS creado_por_nombre, m.nombre AS mascota_nombre
         FROM fichas_medicas f
         LEFT JOIN usuarios u ON f.uploaded_by = u.id
         LEFT JOIN mascotas m ON f.mascota_id = m.id
         WHERE f.id = ?`,
        [id]
      );

      const updated = rows[0];
      const fechaDt = dateFromDbValue(updated.fecha);
      updated.filepath = updated.filename ? fileUrlFromFilename(updated.filename) : null;
      updated.fecha_display = fechaDt ? formatDisplayDate(fechaDt) : '-';

      res.json({ success: true, data: updated });
    } catch (err) {
      console.error('Error update ficha:', err);
      res.status(500).json({ success: false, message: 'Error al actualizar ficha', error: err.message });
    }
  },

  async remove(req, res) {
    try {
      const id = req.params.id;
      const [rows] = await db.query('SELECT * FROM fichas_medicas WHERE id = ?', [id]);
      if (!rows.length) return res.status(404).json({ success: false, message: 'Ficha no encontrada' });
      const r = rows[0];

      if (r.filename) {
        const fp = path.join(medicalDir, r.filename);
        try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) { /* no crítico */ }
      }

      await db.query('DELETE FROM fichas_medicas WHERE id = ?', [id]);
      res.json({ success: true, message: 'Ficha eliminada' });
    } catch (err) {
      console.error('Error delete ficha:', err);
      res.status(500).json({ success: false, message: 'Error al eliminar ficha', error: err.message });
    }
  }
};

module.exports = MedicalController;