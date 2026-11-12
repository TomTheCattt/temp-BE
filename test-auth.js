// Test Better Auth internal methods - debug adapter
require('./src/config/env'); // Load env first
const { auth } = require('./src/config/auth');

async function test() {
  try {
    console.log('Auth options keys:', Object.keys(auth.options));
    console.log('Auth api keys:', Object.keys(auth.api));

    // Check if adapter is accessible
    console.log('Auth $context:', auth.$context);

    // Try to access the internal adapter
    const adapter = auth.$context?.adapter || auth.$adapter;
    console.log('Adapter:', adapter);

    if (adapter) {
      console.log('Adapter keys:', Object.keys(adapter));
      // Try to call findUserByEmail on adapter
      const user = await adapter.findUserByEmail?.('hoangdinh1@example.com');
      console.log('Adapter findUserByEmail result:', user);
    }

  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}

test();