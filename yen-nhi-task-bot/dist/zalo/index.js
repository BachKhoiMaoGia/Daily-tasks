"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.login = login;
exports.onMessage = onMessage;
exports.sendMessage = sendMessage;
exports.getLoginStatus = getLoginStatus;
exports.cleanup = cleanup;
/**
 * zalo/index-fixed.ts
 * Fixed Zalo client for zca-js@2.0.0-beta.21 with proper credential management
 * This addresses the zpw_enk issue by using the exact pattern from zca-js examples
 */
const zca_js_1 = require("zca-js");
const fs_1 = __importDefault(require("fs"));
const index_1 = require("../config/index");
const qr_1 = require("./qr");
const logger_1 = __importDefault(require("../utils/logger"));
let zaloInstance = null;
let apiInstance = null;
const SESSION_FILE = index_1.config.zaloCookiePath.replace('.credentials.json', '.session.json');
const CREDENTIALS_FILE = index_1.config.zaloCookiePath;
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours
/**
 * Decode and setup credentials from environment variables (for Render deployment)
 */
function setupCredentialsFromEnv() {
    try {
        if (index_1.config.zaloCredentialsBase64) {
            logger_1.default.info('[Zalo] 🔐 Setting up credentials from environment variables...');
            // Decode credentials
            const credentialsData = Buffer.from(index_1.config.zaloCredentialsBase64, 'base64').toString('utf8');
            fs_1.default.writeFileSync(CREDENTIALS_FILE, credentialsData);
            logger_1.default.info('[Zalo] ✅ Credentials decoded and saved');
            // Decode session if available
            if (index_1.config.zaloSessionBase64) {
                const sessionData = Buffer.from(index_1.config.zaloSessionBase64, 'base64').toString('utf8');
                fs_1.default.writeFileSync(SESSION_FILE, sessionData);
                logger_1.default.info('[Zalo] ✅ Session decoded and saved');
            }
            return true;
        }
        return false;
    }
    catch (err) {
        logger_1.default.error('[Zalo] ❌ Failed to setup credentials from environment:', err);
        return false;
    }
}
/**
 * Save complete credentials using the zca-js pattern
 */
function saveCredentials(api) {
    try {
        const context = api.getContext();
        const credentials = {
            imei: context.imei,
            userAgent: context.userAgent,
            cookie: context.cookie.toJSON()?.cookies || [],
            language: context.language || 'vi',
            timestamp: Date.now()
        };
        fs_1.default.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), 'utf8');
        logger_1.default.info(`[Zalo] ✅ Credentials saved: ${credentials.cookie.length} cookies, imei: ${credentials.imei}`);
        return credentials;
    }
    catch (err) {
        logger_1.default.error('[Zalo] ❌ Failed to save credentials:', err);
        return null;
    }
}
/**
 * Load saved credentials
 */
function loadCredentials() {
    try {
        if (!fs_1.default.existsSync(CREDENTIALS_FILE)) {
            logger_1.default.info('[Zalo] No saved credentials found');
            return null;
        }
        const data = fs_1.default.readFileSync(CREDENTIALS_FILE, 'utf8');
        const credentials = JSON.parse(data);
        // Validate credentials structure
        if (!credentials.imei || !credentials.userAgent || !Array.isArray(credentials.cookie)) {
            logger_1.default.warn('[Zalo] Invalid credentials structure, will delete');
            fs_1.default.unlinkSync(CREDENTIALS_FILE);
            return null;
        }
        // Check if credentials are too old (older than session max age)
        if (Date.now() - credentials.timestamp > SESSION_MAX_AGE) {
            logger_1.default.info('[Zalo] Credentials expired, will delete');
            fs_1.default.unlinkSync(CREDENTIALS_FILE);
            return null;
        }
        logger_1.default.info(`[Zalo] ✅ Loaded valid credentials: ${credentials.cookie.length} cookies, age: ${Math.round((Date.now() - credentials.timestamp) / 1000 / 60)} minutes`);
        return credentials;
    }
    catch (err) {
        logger_1.default.error('[Zalo] Failed to load credentials:', err);
        return null;
    }
}
/**
 * Save session state
 */
function saveSessionState(data) {
    try {
        const session = {
            isLoggedIn: false,
            timestamp: Date.now(),
            loginMethod: 'qr',
            sessionType: 'direct_api',
            apiInstanceAvailable: !!apiInstance,
            ...data
        };
        fs_1.default.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
        logger_1.default.info(`[Zalo] Session saved: ${session.loginMethod} login, ${session.sessionType} mode`);
    }
    catch (err) {
        logger_1.default.error('[Zalo] Failed to save session state:', err);
    }
}
/**
 * Load session state
 */
function loadSessionState() {
    try {
        if (!fs_1.default.existsSync(SESSION_FILE)) {
            return null;
        }
        const data = fs_1.default.readFileSync(SESSION_FILE, 'utf8');
        const session = JSON.parse(data);
        // Check if session is expired
        if (Date.now() - session.timestamp > SESSION_MAX_AGE) {
            logger_1.default.info('[Zalo] Session expired');
            return null;
        }
        return session;
    }
    catch (err) {
        logger_1.default.error('[Zalo] Failed to load session state:', err);
        return null;
    }
}
/**
 * Validate that credentials can be used for login
 */
function isValidCredentials(credentials) {
    return !!(credentials.cookie && credentials.imei && credentials.userAgent);
}
/**
 * Main login function with proper credential management
 */
async function login() {
    const zalo = getZaloInstance();
    // Check existing session and API instance
    const session = loadSessionState();
    if (session && session.isLoggedIn && apiInstance) {
        logger_1.default.info('[Zalo] ✅ Using existing API instance from valid session');
        return apiInstance;
    } // Try to setup credentials from environment first (for Render deployment)
    if (!fs_1.default.existsSync(CREDENTIALS_FILE)) {
        const envSetup = setupCredentialsFromEnv();
        if (envSetup) {
            logger_1.default.info('[Zalo] 🚀 Environment credentials setup for production deployment');
        }
    }
    // Try cookie-based login first
    const savedCredentials = loadCredentials();
    if (savedCredentials && isValidCredentials(savedCredentials)) {
        logger_1.default.info('[Zalo] 🔄 Attempting cookie-based login...');
        try {
            // Use exact format that zca-js expects
            const api = await zalo.login({
                cookie: savedCredentials.cookie,
                imei: savedCredentials.imei,
                userAgent: savedCredentials.userAgent,
                language: savedCredentials.language
            });
            if (api) {
                apiInstance = api;
                logger_1.default.info('[Zalo] ✅ Cookie-based login successful!');
                // Update session state
                saveSessionState({
                    isLoggedIn: true,
                    loginMethod: 'cookies',
                    sessionType: 'cookie_based',
                    apiInstanceAvailable: true,
                    userId: savedCredentials.imei
                });
                setupMessageListener(api);
                return api;
            }
        }
        catch (err) {
            logger_1.default.error('[Zalo] ❌ Cookie-based login failed:', err.message);
            logger_1.default.info('[Zalo] Will fallback to QR login...');
            // Delete invalid credentials
            if (fs_1.default.existsSync(CREDENTIALS_FILE)) {
                fs_1.default.unlinkSync(CREDENTIALS_FILE);
                logger_1.default.info('[Zalo] Deleted invalid credentials file');
            }
        }
    }
    // Fallback to QR login
    logger_1.default.info('[Zalo] 📱 Starting QR login...');
    try {
        const api = await zalo.loginQR({
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
            language: "vi",
            qrPath: "./qr.png"
        }, (event) => {
            switch (event.type) {
                case 0: // QRCodeGenerated
                    logger_1.default.info('[Zalo] 📱 QR Code generated, please scan with your phone');
                    if (event.data) {
                        (0, qr_1.storeQRData)(event.data);
                    }
                    break;
                case 1: // QRCodeExpired
                    logger_1.default.warn('[Zalo] ⏰ QR Code expired');
                    break;
                case 2: // QRCodeScanned
                    logger_1.default.info('[Zalo] ✅ QR Code scanned successfully');
                    (0, qr_1.clearQR)();
                    break;
                case 3: // QRCodeDeclined
                    logger_1.default.warn('[Zalo] ❌ QR Code scan declined');
                    break;
                case 4: // GotLoginInfo
                    logger_1.default.info('[Zalo] 📄 Login information received');
                    // Save credentials here using the callback data
                    if (event.data) {
                        try {
                            const callbackCredentials = {
                                imei: event.data.imei,
                                userAgent: event.data.userAgent,
                                cookie: event.data.cookie,
                                language: 'vi',
                                timestamp: Date.now()
                            };
                            fs_1.default.writeFileSync(CREDENTIALS_FILE, JSON.stringify(callbackCredentials, null, 2), 'utf8');
                            logger_1.default.info(`[Zalo] 💾 Pre-saved credentials from callback: ${callbackCredentials.cookie?.length || 0} cookies`);
                        }
                        catch (err) {
                            logger_1.default.warn('[Zalo] Failed to pre-save credentials from callback:', err);
                        }
                    }
                    break;
            }
        });
        if (api) {
            apiInstance = api;
            logger_1.default.info('[Zalo] ✅ QR login successful!');
            // Save credentials for future cookie-based logins
            const savedCredentials = saveCredentials(api);
            // Save session state
            saveSessionState({
                isLoggedIn: true,
                loginMethod: 'qr',
                sessionType: 'direct_api',
                apiInstanceAvailable: true,
                userId: savedCredentials?.imei || 'unknown'
            });
            setupMessageListener(api);
            return api;
        }
    }
    catch (err) {
        logger_1.default.error('[Zalo] ❌ QR login failed:', err.message);
        throw new Error(`Zalo login failed: ${err.message}`);
    }
    throw new Error('Unable to login to Zalo');
}
/**
 * Setup message listener
 */
function setupMessageListener(api) {
    try {
        if (api.listener) {
            logger_1.default.info('[Zalo] 🎧 Setting up message listener...');
            api.listener.start();
            logger_1.default.info('[Zalo] ✅ Message listener started successfully');
        }
        else {
            logger_1.default.warn('[Zalo] ⚠️ API listener not available');
        }
    }
    catch (err) {
        logger_1.default.error('[Zalo] ❌ Failed to setup message listener:', err);
    }
}
/**
 * Setup message handler
 */
function onMessage(handler) {
    if (apiInstance && apiInstance.listener) {
        logger_1.default.info('[Zalo] 📨 Setting up message handler...');
        apiInstance.listener.on('message', (msg) => {
            logger_1.default.info('[Zalo] 📬 Received message:', {
                from: msg.uidFrom || msg.senderId || msg.fromId,
                type: msg.type,
                hasContent: !!(msg.data?.content || msg.content)
            });
            handler(msg);
        });
        logger_1.default.info('[Zalo] ✅ Message handler setup complete');
    }
    else {
        logger_1.default.warn('[Zalo] ⚠️ API instance or listener not available for message handling');
        // Retry after a short delay
        setTimeout(() => {
            if (apiInstance && apiInstance.listener) {
                logger_1.default.info('[Zalo] 🔄 Retrying message handler setup...');
                onMessage(handler);
            }
        }, 5000);
    }
}
/**
 * Send message with improved error handling
 */
async function sendMessage(userId, text) {
    if (!apiInstance || !apiInstance.sendMessage) {
        logger_1.default.error('[Zalo] ❌ API instance not available for sending message');
        throw new Error('Zalo API not ready for sending messages');
    }
    try {
        const result = await apiInstance.sendMessage({
            msg: text,
            mentions: []
        }, userId, zca_js_1.ThreadType.User);
        logger_1.default.info(`[Zalo] ✅ Message sent to ${userId}: ${text.substring(0, 50)}...`);
        return result;
    }
    catch (err) {
        logger_1.default.error('[Zalo] ❌ Failed to send message:', err);
        throw err;
    }
}
/**
 * Get Zalo instance
 */
function getZaloInstance() {
    if (!zaloInstance) {
        zaloInstance = new zca_js_1.Zalo();
    }
    return zaloInstance;
}
/**
 * Get current login status
 */
function getLoginStatus() {
    const session = loadSessionState();
    const credentials = loadCredentials();
    return {
        isLoggedIn: !!apiInstance,
        hasSession: !!session,
        hasCredentials: !!credentials,
        sessionType: session?.sessionType || 'none',
        userId: session?.userId || 'unknown',
        loginMethod: session?.loginMethod || 'none',
        credentialsAge: credentials ? Math.round((Date.now() - credentials.timestamp) / 1000 / 60) : -1
    };
}
/**
 * Force cleanup - useful for testing
 */
function cleanup() {
    apiInstance = null;
    zaloInstance = null;
    // Optionally clear files
    try {
        if (fs_1.default.existsSync(SESSION_FILE))
            fs_1.default.unlinkSync(SESSION_FILE);
        if (fs_1.default.existsSync(CREDENTIALS_FILE))
            fs_1.default.unlinkSync(CREDENTIALS_FILE);
        logger_1.default.info('[Zalo] 🧹 Cleanup completed');
    }
    catch (err) {
        logger_1.default.warn('[Zalo] Warning during cleanup:', err);
    }
}
exports.default = { login, onMessage, sendMessage, getLoginStatus, cleanup };
