/**
 * Daily Bot Health Check Script
 * Run this daily to verify all systems are operational
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

console.log('🤖 Zalo Task Bot - Daily Health Check');
console.log('='.repeat(50));
console.log(`📅 Date: ${new Date().toLocaleString()}\n`);

// 1. Server Status Check
async function checkServerStatus() {
    return new Promise((resolve) => {
        const req = http.get('http://localhost:3000', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200 && data.includes('Bot is running!')) {
                    console.log('✅ Server Status: RUNNING (HTTP 200)');
                    resolve(true);
                } else {
                    console.log(`❌ Server Status: ERROR (HTTP ${res.statusCode})`);
                    resolve(false);
                }
            });
        });

        req.on('error', () => {
            console.log('❌ Server Status: NOT RUNNING');
            resolve(false);
        });

        req.setTimeout(5000, () => {
            console.log('❌ Server Status: TIMEOUT');
            resolve(false);
        });
    });
}

// 2. Authentication Status Check
function checkAuthStatus() {
    try {
        const sessionPath = '.cookies.session.json';

        if (!fs.existsSync(sessionPath)) {
            console.log('❌ Authentication: SESSION FILE MISSING');
            return false;
        }

        const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

        if (session.isLoggedIn && session.loginMethod === 'cookies') {
            console.log(`✅ Authentication: LOGGED IN (${session.loginMethod})`);
            console.log(`   User ID: ${session.userId?.slice(0, 20)}...`);
            return true;
        } else {
            console.log('❌ Authentication: NOT LOGGED IN');
            return false;
        }
    } catch (err) {
        console.log('❌ Authentication: ERROR reading session file');
        return false;
    }
}

// 3. Voice Activity Check
function checkVoiceActivity() {
    try {
        const tmpDir = './tmp';

        if (!fs.existsSync(tmpDir)) {
            console.log('❌ Voice Activity: tmp/ directory missing');
            return false;
        }

        const audioFiles = fs.readdirSync(tmpDir).filter(f => f.endsWith('.audio'));

        if (audioFiles.length === 0) {
            console.log('❌ Voice Activity: No audio files found');
            return false;
        }

        // Check for recent activity (within last 24 hours)
        const recentFiles = audioFiles.filter(file => {
            const filePath = path.join(tmpDir, file);
            const stats = fs.statSync(filePath);
            const ageHours = (Date.now() - stats.mtime.getTime()) / 1000 / 60 / 60;
            return ageHours < 24;
        });

        console.log(`✅ Voice Activity: ${audioFiles.length} total files (${recentFiles.length} recent)`);
        return true;
    } catch (err) {
        console.log('❌ Voice Activity: ERROR checking files');
        return false;
    }
}

// 4. Database Status Check
function checkDatabaseStatus() {
    try {
        const dbPath = './tasks.db';

        if (!fs.existsSync(dbPath)) {
            console.log('❌ Database: tasks.db missing');
            return false;
        }

        const stats = fs.statSync(dbPath);
        const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
        const lastModified = stats.mtime.toLocaleString();

        console.log(`✅ Database: ${sizeMB}MB (last modified: ${lastModified})`);
        return true;
    } catch (err) {
        console.log('❌ Database: ERROR checking file');
        return false;
    }
}

// 5. Google Calendar Credentials Check
function checkGoogleCredentials() {
    try {
        const tokenPath = './token.json';

        if (!fs.existsSync(tokenPath)) {
            console.log('❌ Google Calendar: token.json missing');
            return false;
        }

        const token = JSON.parse(fs.readFileSync(tokenPath, 'utf8'));

        if (token.refresh_token) {
            console.log('✅ Google Calendar: OAuth2 token available');
            return true;
        } else {
            console.log('❌ Google Calendar: Invalid token format');
            return false;
        }
    } catch (err) {
        console.log('❌ Google Calendar: ERROR reading token');
        return false;
    }
}

// Run all checks
async function runHealthCheck() {
    const results = [];

    results.push(await checkServerStatus());
    results.push(checkAuthStatus());
    results.push(checkVoiceActivity());
    results.push(checkDatabaseStatus());
    results.push(checkGoogleCredentials());

    const passedChecks = results.filter(r => r).length;
    const totalChecks = results.length;

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Health Check Summary: ${passedChecks}/${totalChecks} checks passed`);

    if (passedChecks === totalChecks) {
        console.log('🎉 Status: ALL SYSTEMS OPERATIONAL');
        console.log('💚 Bot is healthy and ready for use!');
    } else {
        console.log('⚠️  Status: ISSUES DETECTED');
        console.log('🔧 Check failed items above and take corrective action');
    }

    console.log('\n📋 Next Steps:');
    console.log('   1. Test bot with a voice message');
    console.log('   2. Check task creation and Google Calendar sync');
    console.log('   3. Monitor for any new issues');
    console.log('   4. Run this health check again tomorrow');
}

// Execute health check
runHealthCheck().catch(console.error);
