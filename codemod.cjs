const fs = require('fs');
const path = require('path');

const SRC_DIR = path.join(__dirname, 'src');
const LOGGER_PATH = path.join(SRC_DIR, 'utils', 'logger.ts');

function getRelativePathToLogger(filePath) {
    const dir = path.dirname(filePath);
    let relPath = path.relative(dir, path.dirname(LOGGER_PATH));
    if (relPath === '') {
        return './logger';
    }
    if (!relPath.startsWith('.')) {
        relPath = './' + relPath;
    }
    // Convert backslashes to forward slashes for imports
    relPath = relPath.replace(/\\/g, '/');
    return `${relPath}/logger`;
}

function processDirectory(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
            if (fullPath === LOGGER_PATH) continue;
            processFile(fullPath);
        }
    }
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf-8');

    // Check if the file contains raw console statements
    const hasConsoleLog = /\bconsole\.(log|error|warn|info|debug)\b/.test(content);

    // Also check if it's already using logger to avoid duplicate imports
    const hasLoggerImport = /import\s+\{\s*logger\s*\}\s+from\s+['"][^'"]*logger['"]/.test(content);

    if (hasConsoleLog) {
        // Replace console.* with logger.*
        content = content.replace(/\bconsole\.(log|error|warn|info|debug)\b/g, 'logger.$1');

        // Add import statement if missing
        if (!hasLoggerImport) {
            const relLoggerPath = getRelativePathToLogger(filePath);
            const importStmt = `import { logger } from '${relLoggerPath}';\n`;

            content = importStmt + content;
        }

        fs.writeFileSync(filePath, content, 'utf-8');
        console.log(`Updated ${filePath}`);
    }
}

// Ensure the logger import inside authService.ts isn't relative to a weird directory
// Actually the previous authService.ts modifications might have manually added logger import. 

processDirectory(SRC_DIR);
console.log("Codemod complete.");
