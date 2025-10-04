const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, checkProjectAccessMiddleware } = require('../middleware/auth');
const { executeQuery } = require('../services/queryService');

const router = express.Router();

// Execute SQL query
router.post('/:projectId', authenticateToken, checkProjectAccessMiddleware('read'), [
  body('query').trim().isLength({ min: 1 }),
  body('params').optional().isArray(),
  body('cache').optional().isBoolean()
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

    const { projectId } = req.params;
    const { query, params = [], cache = false } = req.body;

    // Execute query
    const result = await executeQuery(projectId, query, req.user.id, params, cache);

    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
      command: result.command,
      executionTime: result.executionTime,
      cached: result.cached
    });

  } catch (error) {
    console.error('❌ Query execution failed:', error);
    res.status(500).json({
      error: 'Query execution failed',
      message: error.message
    });
  }
});

// Execute SELECT query (read-only)
router.get('/:projectId/select', authenticateToken, checkProjectAccessMiddleware('read'), [
  body('query').trim().isLength({ min: 1 }),
  body('params').optional().isArray(),
  body('cache').optional().isBoolean()
], async (req, res) => {
  try {
    const { projectId } = req.params;
    const { query, params = [], cache = false } = req.query;

    if (!query) {
      return res.status(400).json({
        error: 'Query parameter is required'
      });
    }

    // Ensure it's a SELECT query
    if (!query.trim().toLowerCase().startsWith('select')) {
      return res.status(400).json({
        error: 'Only SELECT queries are allowed for GET requests'
      });
    }

    // Execute query
    const result = await executeQuery(projectId, query, req.user.id, params, cache);

    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
      command: result.command,
      executionTime: result.executionTime,
      cached: result.cached
    });

  } catch (error) {
    console.error('❌ Query execution failed:', error);
    res.status(500).json({
      error: 'Query execution failed',
      message: error.message
    });
  }
});

// Execute INSERT/UPDATE/DELETE query (write access required)
router.post('/:projectId/write', authenticateToken, checkProjectAccessMiddleware('write'), [
  body('query').trim().isLength({ min: 1 }),
  body('params').optional().isArray()
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

    const { projectId } = req.params;
    const { query, params = [] } = req.body;

    // Ensure it's a write query
    const queryType = query.trim().toLowerCase().split(' ')[0];
    if (!['insert', 'update', 'delete', 'create', 'alter', 'drop'].includes(queryType)) {
      return res.status(400).json({
        error: 'Only write queries (INSERT, UPDATE, DELETE, CREATE, ALTER, DROP) are allowed'
      });
    }

    // Execute query
    const result = await executeQuery(projectId, query, req.user.id, params, false);

    res.json({
      success: true,
      data: result.rows,
      rowCount: result.rowCount,
      command: result.command,
      executionTime: result.executionTime
    });

  } catch (error) {
    console.error('❌ Query execution failed:', error);
    res.status(500).json({
      error: 'Query execution failed',
      message: error.message
    });
  }
});

// Get database schema
router.get('/:projectId/schema', authenticateToken, checkProjectAccessMiddleware('read'), async (req, res) => {
  try {
    const { projectId } = req.params;

    const schemaQuery = `
      SELECT 
        table_name,
        column_name,
        data_type,
        is_nullable,
        column_default,
        character_maximum_length
      FROM information_schema.columns 
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;

    const result = await executeQuery(projectId, schemaQuery, req.user.id, [], true);

    // Group by table
    const schema = {};
    result.rows.forEach(row => {
      if (!schema[row.table_name]) {
        schema[row.table_name] = [];
      }
      schema[row.table_name].push({
        column: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default,
        maxLength: row.character_maximum_length
      });
    });

    res.json({
      success: true,
      schema,
      cached: result.cached
    });

  } catch (error) {
    console.error('❌ Schema retrieval failed:', error);
    res.status(500).json({
      error: 'Schema retrieval failed',
      message: error.message
    });
  }
});

// Get table info
router.get('/:projectId/tables', authenticateToken, checkProjectAccessMiddleware('read'), async (req, res) => {
  try {
    const { projectId } = req.params;

    const tablesQuery = `
      SELECT 
        table_name,
        table_type,
        table_comment
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    const result = await executeQuery(projectId, tablesQuery, req.user.id, [], true);

    res.json({
      success: true,
      tables: result.rows,
      cached: result.cached
    });

  } catch (error) {
    console.error('❌ Tables retrieval failed:', error);
    res.status(500).json({
      error: 'Tables retrieval failed',
      message: error.message
    });
  }
});

// Clear cache for project
router.delete('/:projectId/cache', authenticateToken, checkProjectAccessMiddleware('admin'), async (req, res) => {
  try {
    const { projectId } = req.params;
    const { getRedisClient } = require('../config/database');
    const redis = getRedisClient();

    // Clear all cache keys for this project
    const keys = await redis.keys(`query:${projectId}:*`);
    if (keys.length > 0) {
      await redis.del(keys);
    }

    res.json({
      success: true,
      message: `Cleared ${keys.length} cached queries for project ${projectId}`
    });

  } catch (error) {
    console.error('❌ Cache clear failed:', error);
    res.status(500).json({
      error: 'Cache clear failed',
      message: error.message
    });
  }
});

module.exports = router;