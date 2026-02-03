// middleware/auth.js
/**
 * Middleware de Autenticación JWT
 * Ahora intenta obtener usuario desde tabla usuarios; si no existe busca en propietarios.
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const db = require('../db');

/**
 * Middleware para verificar token JWT
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token de acceso requerido',
        error: 'No se proporcionó token de autenticación'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');

    // Intentar buscar en usuarios (tabla usuarios)
    let user = null;
    try {
      user = await User.findById(decoded.userId);
    } catch (e) {
      // si falla User.findById dejamos user = null y seguimos a propietarios
      user = null;
    }

    if (user) {
      req.user = {
        userId: decoded.userId,
        email: decoded.email,
        role: user.role || decoded.role || 'user'
      };
      return next();
    }

    // Si no está en usuarios, buscar en propietarios
    const [rows] = await db.query('SELECT id, nombre, email FROM propietarios WHERE id = ?', [decoded.userId]);
    if (rows && rows.length) {
      req.user = {
        userId: decoded.userId,
        email: decoded.email || rows[0].email,
        role: decoded.role || 'propietario', // token generado en PropietariosController.login usaba role = 'propietario'
        nombre: rows[0].nombre
      };
      return next();
    }

    // no encontrado
    return res.status(401).json({
      success: false,
      message: 'Token inválido',
      error: 'El usuario asociado al token no existe'
    });

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token inválido',
        error: 'El token proporcionado no es válido'
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expirado',
        error: 'El token ha expirado, por favor inicia sesión nuevamente'
      });
    }

    console.error('Error en authenticateToken:', error);
    return res.status(500).json({
      success: false,
      message: 'Error de autenticación',
      error: 'Error interno del servidor'
    });
  }
};

/**
 * Middleware opcional de autenticación
 * (si hay token, lo procesa igual que arriba; si no hay, continúa)
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return next();

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default_secret_key');

    let user = null;
    try { user = await User.findById(decoded.userId); } catch (e) { user = null; }

    if (user) {
      req.user = { userId: decoded.userId, email: decoded.email, role: user.role || decoded.role || 'user' };
      return next();
    }

    const db = require('../db');
    const [rows] = await db.query('SELECT id, nombre, email FROM propietarios WHERE id = ?', [decoded.userId]);
    if (rows && rows.length) {
      req.user = { userId: decoded.userId, email: decoded.email || rows[0].email, role: decoded.role || 'propietario', nombre: rows[0].nombre };
    }

    next();
  } catch (err) {
    // no bloquear si fallo en optionalAuth
    next();
  }
};

const authorizeRoles = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Autenticación requerida' });
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'No tienes permisos para acceder a este recurso' });
    }
    next();
  };
};

// verifyOwnership unchanged
const verifyOwnership = (req, res, next) => {
  const requestedUserId = parseInt(req.params.id);
  const currentUserId = req.user.userId;
  if (requestedUserId !== currentUserId) {
    return res.status(403).json({
      success: false,
      message: 'No tienes permisos para acceder a este recurso',
      error: 'Solo puedes acceder a tu propia información'
    });
  }
  next();
};

module.exports = {
  authenticateToken,
  optionalAuth,
  authorizeRoles,
  verifyOwnership
};