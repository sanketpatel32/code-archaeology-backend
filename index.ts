import Fastify from 'fastify';
import cors from '@fastify/cors';
import sensible from '@fastify/sensible';

const fastify = Fastify({ logger: true });

// Register plugins
await fastify.register(cors, {
    origin: ['http://localhost:3000'], // Allow Next.js client
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    credentials: true,
});

await fastify.register(sensible);

// Define routes
fastify.get('/', async (request, reply) => {
    return { message: 'Hello from Fastify!' };
});

// Example API endpoint
fastify.get('/api/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});

// Start the server
const start = async () => {
    try {
        await fastify.listen({ port: 3001, host: '0.0.0.0' });
        console.log('Server running on http://localhost:3001');
    } catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};

start();