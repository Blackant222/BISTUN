const { Pool } = require('pg');
const Redis = require('redis');

let globalPool = null;
let redisClient = null;

const connectDatabase = async () => {
  try {
    globalPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Test connection
    const client = await globalPool.connect();
    await client.query('SELECT NOW()');
    client.release();
    
    console.log('✅ Global PostgreSQL connected successfully');
    return globalPool;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    throw error;
  }
};

const connectRedis = async () => {
  try {
    redisClient = Redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis error:', err);
    });

    await redisClient.connect();
    console.log('✅ Redis connected successfully');
    return redisClient;
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    throw error;
  }
};

const getGlobalPool = () => {
  if (!globalPool) {
    throw new Error('Global database not connected. Call connectDatabase() first.');
  }
  return globalPool;
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis not connected. Call connectRedis() first.');
  }
  return redisClient;
};

// Create project-specific database connection
const createProjectConnection = async (projectId) => {
  try {
    const globalPool = getGlobalPool();
    
    // Get project database credentials
    const result = await globalPool.query(
      'SELECT database_name, database_user, database_password FROM projects WHERE id = $1 AND is_active = true',
      [projectId]
    );

    if (result.rows.length === 0) {
      throw new Error('Project not found or inactive');
    }

    const { database_name, database_user, database_password } = result.rows[0];

    // Create connection to project database
    const projectPool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: process.env.POSTGRES_PORT || 5432,
      database: database_name,
      user: database_user,
      password: database_password,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    return projectPool;
  } catch (error) {
    console.error('❌ Failed to create project connection:', error);
    throw error;
  }
};

// Execute query on project database
const executeProjectQuery = async (projectId, query, params = []) => {
  let projectPool = null;
  try {
    projectPool = await createProjectConnection(projectId);
    const result = await projectPool.query(query, params);
    return result;
  } catch (error) {
    console.error('❌ Project query failed:', error);
    throw error;
  } finally {
    if (projectPool) {
      await projectPool.end();
    }
  }
};

// Check user access to project
const checkProjectAccess = async (userId, projectId) => {
  try {
    const globalPool = getGlobalPool();
    
    const result = await globalPool.query(
      `SELECT pp.permission_type, p.owner_id 
       FROM project_permissions pp 
       JOIN projects p ON pp.project_id = p.id 
       WHERE pp.user_id = $1 AND pp.project_id = $2 AND pp.expires_at > NOW()
       UNION
       SELECT 'admin' as permission_type, p.owner_id
       FROM projects p
       WHERE p.owner_id = $1 AND p.id = $2`,
      [userId, projectId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  } catch (error) {
    console.error('❌ Project access check failed:', error);
    throw error;
  }
};

// Cache query results
const cacheQueryResult = async (key, result, ttl = 300) => {
  try {
    const redis = getRedisClient();
    await redis.setEx(key, ttl, JSON.stringify(result));
  } catch (error) {
    console.error('❌ Failed to cache query result:', error);
  }
};

// Get cached query result
const getCachedQueryResult = async (key) => {
  try {
    const redis = getRedisClient();
    const cached = await redis.get(key);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('❌ Failed to get cached query result:', error);
    return null;
  }
};

module.exports = {
  connectDatabase,
  connectRedis,
  getGlobalPool,
  getRedisClient,
  createProjectConnection,
  executeProjectQuery,
  checkProjectAccess,
  cacheQueryResult,
  getCachedQueryResult
};