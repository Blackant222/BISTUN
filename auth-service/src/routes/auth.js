const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { createKeycloakUser, getKeycloakUser } = require('../config/keycloak');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register new user
router.post('/register', [
  body('email').isEmail().normalizeEmail(),
  body('name').trim().isLength({ min: 2, max: 100 }),
  body('family_name').trim().isLength({ min: 2, max: 100 }),
  body('gender').optional().isIn(['male', 'female', 'other']),
  body('date_of_birth').optional().isISO8601().toDate(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { email, name, family_name, gender, date_of_birth, password } = req.body;

    // Check if user already exists
    const existingUser = await query(
      'SELECT id FROM global_users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        error: 'User already exists',
        message: 'A user with this email already exists'
      });
    }

    // Create user in Keycloak
    const keycloakUser = await createKeycloakUser({
      email,
      name,
      family_name,
      password
    });

    // Extract Keycloak user ID from location header
    const keycloakId = keycloakUser.headers?.location?.split('/').pop();

    // Create user in global database
    const result = await query(
      `INSERT INTO global_users (keycloak_id, email, name, family_name, gender, date_of_birth)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, name, family_name, created_at`,
      [keycloakId, email, name, family_name, gender, date_of_birth]
    );

    const user = result.rows[0];

    // Log the registration
    await query(
      `INSERT INTO audit_logs (user_id, action, resource_type, details)
       VALUES ($1, 'user_registered', 'user', $2)`,
      [user.id, JSON.stringify({ email, name, family_name })]
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        family_name: user.family_name,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('❌ Registration failed:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: 'Failed to create user account'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, email, name, family_name, gender, date_of_birth, created_at, updated_at
       FROM global_users 
       WHERE id = $1`,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        family_name: user.family_name,
        gender: user.gender,
        date_of_birth: user.date_of_birth,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });

  } catch (error) {
    console.error('❌ Failed to get profile:', error);
    res.status(500).json({
      error: 'Failed to get user profile'
    });
  }
});

// Update user profile
router.put('/profile', authenticateToken, [
  body('name').optional().trim().isLength({ min: 2, max: 100 }),
  body('family_name').optional().trim().isLength({ min: 2, max: 100 }),
  body('gender').optional().isIn(['male', 'female', 'other']),
  body('date_of_birth').optional().isISO8601().toDate()
], async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { name, family_name, gender, date_of_birth } = req.body;

    // Build dynamic update query
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (family_name !== undefined) {
      updates.push(`family_name = $${paramCount++}`);
      values.push(family_name);
    }
    if (gender !== undefined) {
      updates.push(`gender = $${paramCount++}`);
      values.push(gender);
    }
    if (date_of_birth !== undefined) {
      updates.push(`date_of_birth = $${paramCount++}`);
      values.push(date_of_birth);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        error: 'No fields to update'
      });
    }

    values.push(req.user.id);

    const result = await query(
      `UPDATE global_users 
       SET ${updates.join(', ')}, updated_at = NOW()
       WHERE id = $${paramCount}
       RETURNING id, email, name, family_name, gender, date_of_birth, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    // Log the update
    await query(
      `INSERT INTO audit_logs (user_id, action, resource_type, details)
       VALUES ($1, 'profile_updated', 'user', $2)`,
      [req.user.id, JSON.stringify({ name, family_name, gender, date_of_birth })]
    );

    res.json({
      message: 'Profile updated successfully',
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        family_name: user.family_name,
        gender: user.gender,
        date_of_birth: user.date_of_birth,
        updated_at: user.updated_at
      }
    });

  } catch (error) {
    console.error('❌ Failed to update profile:', error);
    res.status(500).json({
      error: 'Failed to update profile'
    });
  }
});

// Verify token endpoint
router.post('/verify', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: 'Token is required'
      });
    }

    // Verify token with Keycloak
    const { verifyToken } = require('../config/keycloak');
    const decoded = await verifyToken(token);

    // Get user from database
    const result = await query(
      'SELECT id, email, name, family_name FROM global_users WHERE keycloak_id = $1 AND is_active = true',
      [decoded.sub]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    res.json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        family_name: user.family_name
      },
      token: decoded
    });

  } catch (error) {
    console.error('❌ Token verification failed:', error);
    res.status(401).json({
      error: 'Invalid token',
      valid: false
    });
  }
});

module.exports = router;