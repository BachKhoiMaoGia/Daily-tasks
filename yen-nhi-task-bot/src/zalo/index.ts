/**
 * zalo/index.ts  
 * Fixed Zalo client for zca-js@2.0.0-beta.21 with proper credential management
 * This addresses the zpw_enk issue by using the exact pattern from zca-js examples
 */
import { Zalo, type API, type Credentials, ThreadType } from 'zca-js';
import fs from 'fs';
import { config } from '../config/index';
import { storeQRData, clearQR } from './qr';
import logger from '../utils/logger';

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

const SESSION_FILE = config.zaloCookiePath.replace('.credentials.json', '.session.json');
const CREDENTIALS_FILE = config.zaloCookiePath;
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

// QR Login retry mechanism
const MAX_QR_RETRIES = 3;
let qrRetryCount = 0;

/**
 * Decode and setup credentials from environment variables (for Render deployment)
 */
function setupCredentialsFromEnv(): boolean {
    try {
        logger.info('[Zalo] 🔍 Checking environment variables for credentials...');

        // Debug environment variables
        logger.info('[Zalo] Full environment debug:', {
            NODE_ENV: process.env.NODE_ENV,
            hasZALO_CREDENTIALS_BASE64: !!process.env.ZALO_CREDENTIALS_BASE64,
            hasZALO_SESSION_BASE64: !!process.env.ZALO_SESSION_BASE64,
            ZALO_CREDENTIALS_BASE64_length: process.env.ZALO_CREDENTIALS_BASE64?.length || 0,
            ZALO_SESSION_BASE64_length: process.env.ZALO_SESSION_BASE64?.length || 0,
            configCredentialsLength: config.zaloCredentialsBase64?.length || 0,
            configSessionLength: config.zaloSessionBase64?.length || 0,
            allEnvKeys: Object.keys(process.env).filter(key => key.includes('ZALO'))
        });

        logger.info('[Zalo] Environment check:', {
            hasZaloCredentialsBase64: !!config.zaloCredentialsBase64,
            hasZaloSessionBase64: !!config.zaloSessionBase64,
            credentialsLength: config.zaloCredentialsBase64?.length || 0,
            sessionLength: config.zaloSessionBase64?.length || 0
        }); if (config.zaloCredentialsBase64) {
            logger.info('[Zalo] 🔐 Setting up credentials from environment variables...');
            logger.info(`[Zalo] Base64 credentials length: ${config.zaloCredentialsBase64.length}`);

            // Decode credentials
            let credentialsData: string;
            try {
                credentialsData = Buffer.from(config.zaloCredentialsBase64, 'base64').toString('utf8');
                logger.info(`[Zalo] ✅ Base64 decode successful, length: ${credentialsData.length}`);
            } catch (decodeErr) {
                logger.error('[Zalo] ❌ Failed to decode base64 credentials:', decodeErr);
                return false;
            }

            // Parse and validate before saving
            let parsed: any;
            try {
                parsed = JSON.parse(credentialsData);
                logger.info(`[Zalo] ✅ JSON parse successful`);

                const ageMinutes = parsed.timestamp ? Math.round((Date.now() - parsed.timestamp) / 1000 / 60) : 'unknown';
                const ageDays = parsed.timestamp ? Math.round((Date.now() - parsed.timestamp) / 1000 / 60 / 60 / 24) : 'unknown';

                logger.info(`[Zalo] Credentials structure:`, {
                    hasImei: !!parsed.imei,
                    imeiLength: parsed.imei?.length || 0,
                    hasUserAgent: !!parsed.userAgent,
                    userAgentLength: parsed.userAgent?.length || 0,
                    hasCookie: !!parsed.cookie,
                    cookieType: Array.isArray(parsed.cookie) ? 'array' : typeof parsed.cookie,
                    cookieLength: Array.isArray(parsed.cookie) ? parsed.cookie.length : 0,
                    hasLanguage: !!parsed.language,
                    language: parsed.language,
                    hasTimestamp: !!parsed.timestamp,
                    timestamp: parsed.timestamp,
                    ageMinutes: ageMinutes,
                    ageDays: ageDays,
                    note: 'Production credentials - age limit ignored'
                });
            } catch (parseErr) {
                logger.error('[Zalo] ❌ Failed to parse credentials JSON:', parseErr);
                logger.error('[Zalo] Raw credentials data (first 200 chars):', credentialsData.substring(0, 200));
                return false;
            }

            // Write to file
            try {
                fs.writeFileSync(CREDENTIALS_FILE, credentialsData);
                logger.info(`[Zalo] ✅ Credentials written to file: ${CREDENTIALS_FILE}`);
            } catch (writeErr) {
                logger.error('[Zalo] ❌ Failed to write credentials file:', writeErr);
                return false;
            }

            // Decode session if available
            if (config.zaloSessionBase64) {
                try {
                    const sessionData = Buffer.from(config.zaloSessionBase64, 'base64').toString('utf8');
                    fs.writeFileSync(SESSION_FILE, sessionData);
                    logger.info(`[Zalo] ✅ Session decoded and saved to: ${SESSION_FILE}`);
                } catch (sessionErr) {
                    logger.error('[Zalo] ❌ Failed to setup session:', sessionErr);
                }
            }

            return true;
        } else {
            logger.warn('[Zalo] ⚠️ No base64 credentials found in environment variables');
            logger.info('[Zalo] This means no saved credentials are available for cookie login');
        }
        return false;
    } catch (err) {
        logger.error('[Zalo] ❌ Failed to setup credentials from environment:', err);
        logger.error('[Zalo] Error details:', {
            message: (err as Error).message,
            stack: (err as Error).stack?.split('\n').slice(0, 3).join('\n')
        });
        return false;
    }
}

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

        const ageMinutes = Math.round((Date.now() - credentials.timestamp) / 1000 / 60);
        logger.info(`[Zalo] ✅ Loaded credentials: ${credentials.cookie.length} cookies, age: ${ageMinutes} minutes`);

        // For production environment with base64 credentials, allow older credentials
        // They might be from a previous successful login session
        if (config.zaloCredentialsBase64) {
            logger.info('[Zalo] 🌐 Production environment detected, accepting environment credentials regardless of age');
            return credentials;
        }

        // For local development, check expiration (older than 7 days = 168 hours)
        const EXTENDED_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days
        if (Date.now() - credentials.timestamp > EXTENDED_MAX_AGE) {
            logger.info('[Zalo] Local credentials expired (older than 7 days), will delete');
            fs.unlinkSync(CREDENTIALS_FILE);
            return null;
        }

        return credentials;
    } catch (err) {
        logger.error('[Zalo] Failed to load credentials:', err);
        return null;
    }
}

/**
 * Validate that credentials can be used for login
 */
function isValidCredentials(credentials: SavedCredentials | null): credentials is SavedCredentials {
    return !!(credentials && credentials.cookie && credentials.imei && credentials.userAgent);
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
 * QR Login with retry mechanism
 */
async function loginWithQRRetry(zalo: Zalo): Promise<API> {
    while (qrRetryCount < MAX_QR_RETRIES) {
        try {
            logger.info(`[Zalo] 📱 QR Login attempt ${qrRetryCount + 1}/${MAX_QR_RETRIES}`);

            const api = await zalo.loginQR(
                {
                    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
                    language: "vi",
                    qrPath: "./qr.png"
                },
                (event) => {
                    switch (event.type) {
                        case 0: // QRCodeGenerated
                            logger.info('[Zalo] 📱 QR Code generated, please scan with your phone');
                            logger.info(`[Zalo] 🌐 QR available at: ${process.env.RENDER_EXTERNAL_URL || 'http://localhost:' + config.port}/qr`);
                            if (event.data) {
                                console.log('[Zalo] QR Event Data:', {
                                    hasCode: !!(event.data as any).code,
                                    hasImage: !!(event.data as any).image,
                                    imageLength: (event.data as any).image ? (event.data as any).image.length : 0,
                                    allKeys: Object.keys(event.data)
                                });
                                storeQRData(event.data);
                            }
                            break;
                        case 1: // QRCodeExpired
                            logger.warn(`[Zalo] ⏰ QR Code expired (attempt ${qrRetryCount + 1})`);
                            clearQR();
                            // Auto-regenerate if we haven't exceeded max retries
                            if (qrRetryCount < MAX_QR_RETRIES - 1) {
                                logger.info('[Zalo] 🔄 Auto-regenerating QR code...');
                                // The retry will happen automatically in the outer loop
                            } else {
                                logger.warn('[Zalo] ❌ Reached max QR expiration retries');
                            }
                            break;
                        case 2: // QRCodeScanned
                            logger.info('[Zalo] ✅ QR Code scanned successfully');
                            clearQR();
                            break;
                        case 3: // QRCodeDeclined
                            logger.warn('[Zalo] ❌ QR Code scan declined');
                            clearQR();
                            break;
                        case 4: // GotLoginInfo
                            logger.info('[Zalo] 📄 Login information received');
                            // Save credentials here using the callback data
                            if (event.data) {
                                try {
                                    const callbackCredentials = {
                                        imei: (event.data as any).imei,
                                        userAgent: (event.data as any).userAgent,
                                        cookie: (event.data as any).cookie,
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
                        default:
                            logger.info(`[Zalo] QR Event type ${event.type}:`, event.data);
                            break;
                    }
                }
            );

            if (api) {
                qrRetryCount = 0; // Reset retry count on success
                return api;
            }
        } catch (err) {
            qrRetryCount++;
            logger.error(`[Zalo] ❌ QR login attempt ${qrRetryCount} failed:`, (err as Error).message);

            if (qrRetryCount >= MAX_QR_RETRIES) {
                throw new Error(`Zalo QR login failed after ${MAX_QR_RETRIES} attempts: ${(err as Error).message}`);
            }

            // Wait before retry
            logger.info(`[Zalo] ⏳ Waiting 10 seconds before retry...`);
            await new Promise(resolve => setTimeout(resolve, 10000));
        }
    }

    throw new Error('Unable to login to Zalo after retries');
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

    // FIXED LOGIC: Always try to setup from environment if available, regardless of file existence
    if (config.zaloCredentialsBase64) {
        logger.info('[Zalo] 🌐 Environment credentials detected, setting up...');
        const envSetup = setupCredentialsFromEnv();
        if (envSetup) {
            logger.info('[Zalo] 🚀 Environment credentials setup successful for production deployment');
        } else {
            logger.error('[Zalo] ❌ Environment credentials setup failed despite having base64 data');
        }
    } else if (!fs.existsSync(CREDENTIALS_FILE)) {
        logger.info('[Zalo] 📝 No environment credentials and no local file, will need QR login');
    }    // Try cookie-based login first
    const savedCredentials: SavedCredentials | null = loadCredentials();
    if (savedCredentials && isValidCredentials(savedCredentials)) {
        logger.info('[Zalo] 🔄 Attempting cookie-based login...');

        const ageMinutes = Math.round((Date.now() - savedCredentials.timestamp) / 1000 / 60);
        logger.info(`[Zalo] Credentials details:`, {
            imei: savedCredentials.imei?.substring(0, 10) + '...',
            userAgent: savedCredentials.userAgent?.substring(0, 50) + '...',
            cookieCount: savedCredentials.cookie?.length || 0,
            language: savedCredentials.language,
            ageMinutes: ageMinutes,
            source: config.zaloCredentialsBase64 ? 'environment' : 'local'
        });

        try {
            // Use exact format that zca-js expects
            const loginCredentials = {
                cookie: savedCredentials.cookie,
                imei: savedCredentials.imei,
                userAgent: savedCredentials.userAgent,
                language: savedCredentials.language
            };

            logger.info('[Zalo] Login credentials validation:', {
                cookieIsArray: Array.isArray(loginCredentials.cookie),
                cookieCount: Array.isArray(loginCredentials.cookie) ? loginCredentials.cookie.length : 0,
                imeiLength: loginCredentials.imei ? loginCredentials.imei.length : 0,
                userAgentLength: loginCredentials.userAgent ? loginCredentials.userAgent.length : 0,
                language: loginCredentials.language
            });

            logger.info('[Zalo] Calling zalo.login() with credentials...');
            const api = await zalo.login(loginCredentials);

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
            } else {
                logger.warn('[Zalo] ⚠️ Cookie login returned null/undefined - cookies may be invalid');
            }
        } catch (err) {
            logger.error('[Zalo] ❌ Cookie-based login failed:', (err as Error).message);
            logger.error('[Zalo] Error details:', err);
            logger.info('[Zalo] Will fallback to QR login...');

            // Only delete credentials if they're local (not from environment)
            if (!config.zaloCredentialsBase64 && fs.existsSync(CREDENTIALS_FILE)) {
                fs.unlinkSync(CREDENTIALS_FILE);
                logger.info('[Zalo] Deleted invalid local credentials file');
            } else if (config.zaloCredentialsBase64) {
                logger.info('[Zalo] Keeping environment credentials - they may work later');
            }
        }
    } else {
        logger.info('[Zalo] No valid saved credentials found for cookie login');
        if (savedCredentials !== null) {
            logger.info('[Zalo] Saved credentials validation failed:', {
                hasCredentials: !!savedCredentials,
                fileExists: fs.existsSync(CREDENTIALS_FILE)
            });
        }
    }

    // Fallback to QR login with retry
    logger.info('[Zalo] 📱 Starting QR login with retry mechanism...');
    try {
        const api = await loginWithQRRetry(zalo);

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
            setupConnectionHealthCheck();
            return api;
        }
    } catch (err) {
        logger.error('[Zalo] ❌ QR login with retry failed:', (err as Error).message);
        throw new Error(`Zalo login failed: ${(err as Error).message}`);
    }

    throw new Error('Unable to login to Zalo');
}

/**
 * Force QR login (for regeneration)
 */
export async function forceQRLogin(): Promise<void> {
    logger.info('[Zalo] 🔄 Force QR login initiated...');

    // Clear existing state
    apiInstance = null;
    qrRetryCount = 0;
    clearQR();

    try {
        const zalo = getZaloInstance();
        const api = await loginWithQRRetry(zalo);

        if (api) {
            apiInstance = api;
            logger.info('[Zalo] ✅ Force QR login successful!');

            // Save credentials and session
            const savedCredentials = saveCredentials(api);
            saveSessionState({
                isLoggedIn: true,
                loginMethod: 'qr',
                sessionType: 'direct_api',
                apiInstanceAvailable: true,
                userId: savedCredentials?.imei || 'unknown'
            });

            setupMessageListener(api);
            setupConnectionHealthCheck();
        }
    } catch (err) {
        logger.error('[Zalo] ❌ Force QR login failed:', (err as Error).message);
        throw err;
    }
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
 * Setup connection health check and auto-regeneration
 */
function setupConnectionHealthCheck() {
    // Check connection every 10 minutes
    setInterval(async () => {
        try {
            const status = getLoginStatus();
            logger.info(`[Zalo] Health check - Status: ${JSON.stringify(status)}`);

            // If no API instance or session expired, try auto-regeneration
            if (!apiInstance || !status.isLoggedIn) {
                logger.warn('[Zalo] ⚠️ Connection lost, attempting auto-regeneration...');
                try {
                    await forceQRLogin();
                    logger.info('[Zalo] ✅ Auto-regeneration successful');
                } catch (err) {
                    logger.error('[Zalo] ❌ Auto-regeneration failed:', (err as Error).message);
                }
            }
        } catch (err) {
            logger.error('[Zalo] Health check error:', err);
        }
    }, 10 * 60 * 1000); // 10 minutes
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
