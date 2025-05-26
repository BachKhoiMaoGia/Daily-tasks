/**
 * zalo/index-fixed.ts  
 * Fixed Zalo client for zca-js@2.0.0-beta.21 with proper credential management
 * This addresses the zpw_enk issue by using the exact pattern from zca-js examples
 */
import { Zalo, type API, type Credentials, ThreadType } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index.js';
import { storeQRData, clearQR } from './qr.js';
import logger from '../utils/logger.js';

let zaloInstance: Zalo | null = null;
let apiInstance: API | null = null;

// Session management
interface SessionData {
    isLoggedIn: boolean;
    timestamp: number;
    userId?: string;
    loginMethod: 'qr' | 'cookies';
    sessionType: 'direct_api' | 'cookie_based';
    apiInstanceAvailable: boolean;
}

interface SavedCredentials {
    imei: string;
    userAgent: string;
    cookie: any[];
    language: string;
    timestamp: number;
}

const SESSION_FILE = config.zaloCookiePath.replace('.txt', '.session.json');
const CREDENTIALS_FILE = config.zaloCookiePath.replace('.txt', '.credentials.json');
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Save complete credentials using the zca-js pattern
 */
function saveCredentials(api: API): SavedCredentials | null {
    try {
        const context = api.getContext();
        const credentials: SavedCredentials = {
            imei: context.imei!,
            userAgent: context.userAgent!,
            cookie: context.cookie.toJSON()?.cookies || [],
            language: context.language || 'vi',
            timestamp: Date.now()
        };

        fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), 'utf8');
        logger.info(`[Zalo] ✅ Credentials saved: ${credentials.cookie.length} cookies, imei: ${credentials.imei}`);

        return credentials;
    } catch (err) {
        logger.error('[Zalo] ❌ Failed to save credentials:', err);
        return null;
    }
}

/**
 * Load saved credentials
 */
function loadCredentials(): SavedCredentials | null {
    try {
        if (!fs.existsSync(CREDENTIALS_FILE)) {
            logger.info('[Zalo] No saved credentials found');
            return null;
        }

        const data = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
        const credentials = JSON.parse(data) as SavedCredentials;

        // Validate credentials structure
        if (!credentials.imei || !credentials.userAgent || !Array.isArray(credentials.cookie)) {
            logger.warn('[Zalo] Invalid credentials structure, will delete');
            fs.unlinkSync(CREDENTIALS_FILE);
            return null;
        }

        // Check if credentials are too old (older than session max age)
        if (Date.now() - credentials.timestamp > SESSION_MAX_AGE) {
            logger.info('[Zalo] Credentials expired, will delete');
            fs.unlinkSync(CREDENTIALS_FILE);
            return null;
        }

        logger.info(`[Zalo] ✅ Loaded valid credentials: ${credentials.cookie.length} cookies, age: ${Math.round((Date.now() - credentials.timestamp) / 1000 / 60)} minutes`);
        return credentials;
    } catch (err) {
        logger.error('[Zalo] Failed to load credentials:', err);
        return null;
    }
}

/**
 * Save session state
 */
function saveSessionState(data: Partial<SessionData>) {
    try {
        const session: SessionData = {
            isLoggedIn: false,
            timestamp: Date.now(),
            loginMethod: 'qr',
            sessionType: 'direct_api',
            apiInstanceAvailable: !!apiInstance,
            ...data
        };

        fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
        logger.info(`[Zalo] Session saved: ${session.loginMethod} login, ${session.sessionType} mode`);
    } catch (err) {
        logger.error('[Zalo] Failed to save session state:', err);
    }
}

/**
 * Load session state
 */
function loadSessionState(): SessionData | null {
    try {
        if (!fs.existsSync(SESSION_FILE)) {
            return null;
        }

        const data = fs.readFileSync(SESSION_FILE, 'utf8');
        const session = JSON.parse(data) as SessionData;

        // Check if session is expired
        if (Date.now() - session.timestamp > SESSION_MAX_AGE) {
            logger.info('[Zalo] Session expired');
            return null;
        }

        return session;
    } catch (err) {
        logger.error('[Zalo] Failed to load session state:', err);
        return null;
    }
}

/**
 * Validate that credentials can be used for login
 */
function isValidCredentials(credentials: any): credentials is Credentials {
    return !!(credentials.cookie && credentials.imei && credentials.userAgent);
}

/**
 * Main login function with proper credential management
 */
export async function login(): Promise<API> {
    const zalo = getZaloInstance();

    // Check existing session and API instance
    const session = loadSessionState();
    if (session && session.isLoggedIn && apiInstance) {
        logger.info('[Zalo] ✅ Using existing API instance from valid session');
        return apiInstance;
    }

    // Try cookie-based login first
    const savedCredentials = loadCredentials();
    if (savedCredentials && isValidCredentials(savedCredentials)) {
        logger.info('[Zalo] 🔄 Attempting cookie-based login...');
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
                logger.info('[Zalo] ✅ Cookie-based login successful!');

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
        } catch (err) {
            logger.error('[Zalo] ❌ Cookie-based login failed:', (err as Error).message);
            logger.info('[Zalo] Will fallback to QR login...');

            // Delete invalid credentials
            if (fs.existsSync(CREDENTIALS_FILE)) {
                fs.unlinkSync(CREDENTIALS_FILE);
                logger.info('[Zalo] Deleted invalid credentials file');
            }
        }
    }

    // Fallback to QR login
    logger.info('[Zalo] 📱 Starting QR login...');
    try {
        const api = await zalo.loginQR(
            {
                userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
                language: "vi",
                qrPath: "./qr.png"
            },
            (event) => {
                switch (event.type) {
                    case 0: // QRCodeGenerated
                        logger.info('[Zalo] 📱 QR Code generated, please scan with your phone'); if (event.data) {
                            storeQRData(event.data);
                        }
                        break;
                    case 1: // QRCodeExpired
                        logger.warn('[Zalo] ⏰ QR Code expired');
                        break;
                    case 2: // QRCodeScanned
                        logger.info('[Zalo] ✅ QR Code scanned successfully');
                        clearQR();
                        break;
                    case 3: // QRCodeDeclined
                        logger.warn('[Zalo] ❌ QR Code scan declined');
                        break;
                    case 4: // GotLoginInfo
                        logger.info('[Zalo] 📄 Login information received');
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
                                fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(callbackCredentials, null, 2), 'utf8');
                                logger.info(`[Zalo] 💾 Pre-saved credentials from callback: ${callbackCredentials.cookie?.length || 0} cookies`);
                            } catch (err) {
                                logger.warn('[Zalo] Failed to pre-save credentials from callback:', err);
                            }
                        }
                        break;
                }
            }
        );

        if (api) {
            apiInstance = api;
            logger.info('[Zalo] ✅ QR login successful!');

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
    } catch (err) {
        logger.error('[Zalo] ❌ QR login failed:', err);
        throw new Error(`Zalo login failed: ${(err as Error).message}`);
    }

    throw new Error('Unable to login to Zalo');
}

/**
 * Setup message listener
 */
function setupMessageListener(api: API) {
    try {
        if (api.listener) {
            logger.info('[Zalo] 🎧 Setting up message listener...');

            api.listener.start();
            logger.info('[Zalo] ✅ Message listener started successfully');
        } else {
            logger.warn('[Zalo] ⚠️ API listener not available');
        }
    } catch (err) {
        logger.error('[Zalo] ❌ Failed to setup message listener:', err);
    }
}

/**
 * Setup message handler
 */
export function onMessage(handler: (msg: any) => void) {
    if (apiInstance && apiInstance.listener) {
        logger.info('[Zalo] 📨 Setting up message handler...');

        apiInstance.listener.on('message', (msg: any) => {
            logger.info('[Zalo] 📬 Received message:', {
                from: msg.uidFrom || msg.senderId || msg.fromId,
                type: msg.type,
                hasContent: !!(msg.data?.content || msg.content)
            });
            handler(msg);
        });

        logger.info('[Zalo] ✅ Message handler setup complete');
    } else {
        logger.warn('[Zalo] ⚠️ API instance or listener not available for message handling');

        // Retry after a short delay
        setTimeout(() => {
            if (apiInstance && apiInstance.listener) {
                logger.info('[Zalo] 🔄 Retrying message handler setup...');
                onMessage(handler);
            }
        }, 5000);
    }
}

/**
 * Send message with improved error handling
 */
export async function sendMessage(userId: string, text: string) {
    if (!apiInstance || !apiInstance.sendMessage) {
        logger.error('[Zalo] ❌ API instance not available for sending message');
        throw new Error('Zalo API not ready for sending messages');
    }

    try {
        const result = await apiInstance.sendMessage(
            {
                msg: text,
                mentions: []
            },
            userId,
            ThreadType.User
        );

        logger.info(`[Zalo] ✅ Message sent to ${userId}: ${text.substring(0, 50)}...`);
        return result;
    } catch (err) {
        logger.error('[Zalo] ❌ Failed to send message:', err);
        throw err;
    }
}

/**
 * Get Zalo instance
 */
function getZaloInstance() {
    if (!zaloInstance) {
        zaloInstance = new Zalo();
    }
    return zaloInstance;
}

/**
 * Get current login status
 */
export function getLoginStatus() {
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
export function cleanup() {
    apiInstance = null;
    zaloInstance = null;

    // Optionally clear files
    try {
        if (fs.existsSync(SESSION_FILE)) fs.unlinkSync(SESSION_FILE);
        if (fs.existsSync(CREDENTIALS_FILE)) fs.unlinkSync(CREDENTIALS_FILE);
        logger.info('[Zalo] 🧹 Cleanup completed');
    } catch (err) {
        logger.warn('[Zalo] Warning during cleanup:', err);
    }
}

export default { login, onMessage, sendMessage, getLoginStatus, cleanup };
