const { execSync } = require('child_process');
execSync('git clone https://github.com/BackendKit-labs/backendkit-agent-framework backendkit-agent-framework', { stdio: 'inherit', cwd: __dirname });
