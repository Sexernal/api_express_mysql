/**
 * routes/medicalRoutes.js
 * Rutas para fichas médicas (uploads opcionales).
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');
const requireAdmin = require('../middleware/requireAdmin');
const MedicalController = require('../controllers/medicalController');

// --- multer config ---
const uploadsRoot = path.join(__dirname, '..', 'uploads');
const medicalDir = path.join(uploadsRoot, 'medical');

if (!fs.existsSync(medicalDir)) {
  fs.mkdirSync(medicalDir, { recursive: true });
  try { fs.chmodSync(medicalDir, 0o775); } catch (e) {}
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, medicalDir),
  filename: (req, file, cb) => {
    // safe filename: timestamp + original name
    const ts = Date.now();
    const clean = file.originalname.replace(/[^a-zA-Z0-9.\-_ñÑáéíóúÁÉÍÓÚ ]/g, '');
    cb(null, `${ts}-${clean}`);
  }
});

const fileFilter = (req, file, cb) => {
  const okTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'];
  if (okTypes.includes(file.mimetype)) cb(null, true);
  else cb(null, false); // rechazamos tipos no soportados (no lanzamos error, solo ignoramos)
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB
});

// ---------- RUTAS ----------

// Listar fichas (por mascota). GET /api/v1/medical-records?pet_id=123
router.get('/medical-records', authenticateToken, MedicalController.listByPet);

// Obtener una ficha por id. GET /api/v1/medical-records/:id
router.get('/medical-records/:id', authenticateToken, MedicalController.getById);

// Crear ficha (admin) - admite multipart/form-data o application/json.
// field con archivo: 'file' (opcional)
router.post('/medical-records', authenticateToken, requireAdmin, upload.single('file'), MedicalController.create);

// Actualizar ficha (admin) - admite file opcional (reemplaza si se envía)
router.put('/medical-records/:id', authenticateToken, requireAdmin, upload.single('file'), MedicalController.update);

// Eliminar ficha (admin)
router.delete('/medical-records/:id', authenticateToken, requireAdmin, MedicalController.remove);

module.exports = router;