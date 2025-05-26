/**
 * zalo/index-optimized.ts  
 * Optimized Zalo client for zca-js@2.0.0-beta.21 with improved cookie handling
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
    // Complete credentials for proper cookie-based login
    credentials?: {
        imei: string;
        userAgent: string;
        cookie: any[];
        language?: string;
    };
}

const SESSION_FILE = config.zaloCookiePath.replace('.txt', '.session.json');
const CREDENTIALS_FILE = config.zaloCookiePath.replace('.txt', '.credentials.json');
const SESSION_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Save complete credentials for cookie-based login
 */
function saveCredentials(api: API) {
    try {
        const context = api.getContext();
        const credentials = {
            imei: context.imei,
            userAgent: context.userAgent,
            cookie: context.cookie.toJSON()?.cookies || [],
            language: context.language || 'vi'
        };

        fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2), 'utf8');
        logger.info(`[Zalo] Credentials saved with ${credentials.cookie.length} cookies`);

        return credentials;
    } catch (err) {
        logger.error('[Zalo] Failed to save credentials:', err);
        return null;
    }
}

/**
 * Load saved credentials
 */
function loadCredentials() {
    try {
        if (!fs.existsSync(CREDENTIALS_FILE)) {
            return null;
        }

        const data = fs.readFileSync(CREDENTIALS_FILE, 'utf8');
        const credentials = JSON.parse(data);

        // Validate credentials structure
        if (!credentials.imei || !credentials.userAgent || !credentials.cookie) {
            logger.warn('[Zalo] Invalid credentials structure');
            return null;
        }

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
        logger.info(`[Zalo] Session state saved: ${session.sessionType}, API available: ${session.apiInstanceAvailable}`);
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
            logger.info('[Zalo] Session expired, will need fresh login');
            return null;
        }

        return session;
    } catch (err) {
        logger.error('[Zalo] Failed to load session state:', err);
        return null;
    }
}

/**
 * Validate cookies structure
 */
function validateCookies(cookies: any[]): boolean {
    if (!Array.isArray(cookies) || cookies.length === 0) {
        return false;
    }

    return cookies.some(cookie => {
        return cookie && (
            (cookie.name && cookie.value) ||
            (cookie.key && cookie.value) ||
            typeof cookie === 'string'
        );
    });
}

/**
 * Enhanced cookie extraction for zca-js@2.0.0-beta.21
 */
async function extractCookiesFromLoginResult(loginResult: any): Promise<any[] | null> {
    try {
        let cookies: any[] | null = null;

        logger.info('[Zalo] Analyzing login result for cookies:', {
            type: typeof loginResult,
            keys: loginResult ? Object.keys(loginResult) : [],
            hasUserInfo: !!loginResult?.userInfo,
            hasCookies: !!loginResult?.cookies || !!loginResult?.cookie
        });

        // Direct cookie access
        if (loginResult.cookies && Array.isArray(loginResult.cookies)) {
            cookies = loginResult.cookies;
        } else if (loginResult.cookie && Array.isArray(loginResult.cookie)) {
            cookies = loginResult.cookie;
        }

        // Try API instance extraction if we have an API
        if (!cookies && (loginResult.sendMessage || loginResult.listener)) {
            const apiAny = loginResult as any;

            // Multiple extraction patterns for zca-js@2.0.0-beta.21
            const extractionMethods = [
                () => apiAny.credential?.cookie,
                () => apiAny.credentials?.cookie,
                () => apiAny._credential?.cookie,
                () => apiAny._credentials?.cookie,
                () => apiAny.session?.cookie,
                () => apiAny._session?.cookie,
                () => apiAny.cookieJar?.cookies,
                () => apiAny._cookieJar?.cookies,
                () => zaloInstance && (zaloInstance as any).credential?.cookie,
                () => zaloInstance && (zaloInstance as any).credentials?.cookie
            ];

            for (const method of extractionMethods) {
                try {
                    const result = method();
                    if (result && Array.isArray(result) && result.length > 0) {
                        cookies = result;
                        logger.info('[Zalo] Successfully extracted cookies from API instance');
                        break;
                    }
                } catch (err) {
                    // Continue to next method
                    continue;
                }
            }
        }

        if (cookies && validateCookies(cookies)) {
            logger.info(`[Zalo] Successfully extracted ${cookies.length} valid cookies`);
            return cookies;
        } else {
            logger.warn('[Zalo] No valid cookies found in login result');
            return null;
        }

    } catch (err) {
        logger.error('[Zalo] Error extracting cookies from login result:', err);
        return null;
    }
}

/**
 * Get user ID from various sources
 */
async function getUserIdFromResult(loginResult: any): Promise<string> {
    try {
        // From userInfo in login result
        if (loginResult.userInfo) {
            const userInfo = loginResult.userInfo;
            return userInfo.id || userInfo.userId || userInfo.uid || 'unknown';
        }

        // From API instance
        if (loginResult.sendMessage || loginResult.listener) {
            const apiAny = loginResult as any;

            if (apiAny.getCurrentUserId) {
                const userId = await apiAny.getCurrentUserId();
                if (userId && userId !== 'unknown') return userId;
            }

            if (apiAny.getUserInfo) {
                const userInfo = await apiAny.getUserInfo();
                if (userInfo) {
                    return userInfo.id || userInfo.userId || userInfo.uid || 'unknown';
                }
            }
        }

        return 'unknown';
    } catch (err) {
        logger.warn('[Zalo] Failed to get user ID:', err);
        return 'unknown';
    }
}

/**
 * Main login function with improved session management
 */
export async function login() {
    const zalo = getZaloInstance();

    // Check existing session
    const session = loadSessionState();
    if (session && session.isLoggedIn && apiInstance) {
        logger.info('[Zalo] Valid session found, reusing existing API instance');
        return apiInstance;
    }

    // Try cookie-based login first (if we have valid cookies)
    const cookiePath = config.zaloCookiePath;
    if (fs.existsSync(cookiePath)) {
        try {
            const cookieData = fs.readFileSync(cookiePath, 'utf8');
            const parsed = JSON.parse(cookieData);

            // Handle both old format (array) and new format (object with cookies)
            const cookies = Array.isArray(parsed) ? parsed : parsed.cookies;

            if (cookies && validateCookies(cookies)) {
                logger.info(`[Zalo] Attempting login with saved cookies (${cookies.length} cookies)`);

                const credentials: Credentials = {
                    imei: 'zca-js-' + Date.now(),
                    cookie: cookies,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    language: 'vi'
                };

                try {
                    const api = await zalo.login(credentials);
                    apiInstance = api;

                    saveSessionState({
                        isLoggedIn: true,
                        loginMethod: 'cookies',
                        sessionType: 'cookie_based',
                        userId: parsed.userId || 'unknown'
                    });

                    logger.info('[Zalo] Successfully logged in with saved cookies');
                    await setupConnectionHealthCheck();
                    return api;
                } catch (err) {
                    logger.warn('[Zalo] Cookie login failed, falling back to QR:', err);
                }
            }
        } catch (err) {
            logger.warn('[Zalo] Failed to load saved cookies:', err);
        }
    }

    // QR Login
    logger.info('[Zalo] Initiating QR login...');

    try {
        const loginResult = await zalo.loginQR({
            qrPath: './qr.png',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            language: 'vi'
        }) as any;

        logger.info('[Zalo] QR Login completed successfully');

        // Get user ID
        const userId = await getUserIdFromResult(loginResult);

        // Try to extract cookies for future use
        const extractedCookies = await extractCookiesFromLoginResult(loginResult);

        // If loginResult is directly an API instance
        if (loginResult && (loginResult.sendMessage || loginResult.listener)) {
            apiInstance = loginResult;

            // Save session state
            saveSessionState({
                isLoggedIn: true,
                loginMethod: 'qr',
                sessionType: 'direct_api',
                userId: userId
            });

            // Save cookies if we extracted them
            if (extractedCookies && extractedCookies.length > 0) {
                const cookieData = {
                    cookies: extractedCookies,
                    timestamp: Date.now(),
                    userId: userId,
                    loginMethod: 'qr'
                };
                fs.writeFileSync(cookiePath, JSON.stringify(cookieData, null, 2), 'utf8');
                logger.info(`[Zalo] Saved ${extractedCookies.length} cookies for future use`);
            } else {
                // Save session info even without cookies
                const sessionInfo = {
                    note: "QR login successful, direct API instance",
                    timestamp: Date.now(),
                    userId: userId,
                    loginMethod: 'qr'
                };
                fs.writeFileSync(cookiePath, JSON.stringify(sessionInfo, null, 2), 'utf8');
                logger.info('[Zalo] Saved session info (no extractable cookies)');
            }

            clearQR();
            await setupConnectionHealthCheck();
            logger.info(`[Zalo] Login completed - User ID: ${userId}`);
            return apiInstance;
        }

        // If we got cookies separately, login with them
        if (extractedCookies && extractedCookies.length > 0) {
            const credentials: Credentials = {
                imei: 'zca-js-' + Date.now(),
                cookie: extractedCookies,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                language: 'vi'
            };

            const api = await zalo.login(credentials);
            apiInstance = api;

            // Save cookies and session
            const cookieData = {
                cookies: extractedCookies,
                timestamp: Date.now(),
                userId: userId,
                loginMethod: 'qr'
            };
            fs.writeFileSync(cookiePath, JSON.stringify(cookieData, null, 2), 'utf8');

            saveSessionState({
                isLoggedIn: true,
                loginMethod: 'qr',
                sessionType: 'cookie_based',
                userId: userId
            });

            clearQR();
            await setupConnectionHealthCheck();
            logger.info(`[Zalo] Login completed with extracted cookies - User ID: ${userId}`);
            return api;
        }

        throw new Error('QR login did not provide usable API instance or cookies');

    } catch (err) {
        logger.error('[Zalo] QR login failed:', err);
        throw err;
    }
}

/**
 * Setup message listener
 */
export function onMessage(handler: (msg: any) => void) {
    if (apiInstance && apiInstance.listener) {
        logger.info('[Zalo] Setting up message listener...');

        apiInstance.listener.on('message', (msg: any) => {
            logger.info('[Zalo] Received message:', {
                from: msg.uidFrom || msg.senderId || msg.fromId,
                type: msg.type,
                hasContent: !!(msg.data?.content || msg.content)
            });
            handler(msg);
        });

        apiInstance.listener.start();
        logger.info('[Zalo] Message listener started successfully');
    } else {
        logger.warn('[Zalo] API instance or listener not available');

        // Retry after a short delay
        setTimeout(() => {
            if (apiInstance && apiInstance.listener) {
                logger.info('[Zalo] Retrying message listener setup...');
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
        logger.error('[Zalo] API instance not available for sending message');
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

        logger.info(`[Zalo] Message sent successfully to ${userId}: ${text.substring(0, 50)}...`);
        return result;
    } catch (err) {
        logger.error('[Zalo] Failed to send message:', err);
        throw err;
    }
}

/**
 * Setup connection health check
 */
async function setupConnectionHealthCheck() {
    if (!apiInstance) return;

    setInterval(async () => {
        try {
            // Simple health check
            const apiAny = apiInstance as any;
            if (apiAny.getUserInfo) {
                await apiAny.getUserInfo();
                logger.debug('[Zalo] Connection health check passed');
            }
        } catch (err) {
            logger.warn('[Zalo] Connection health check failed:', err);
            // Could implement reconnection logic here
        }
    }, 10 * 60 * 1000); // 10 minutes

    logger.info('[Zalo] Connection health check setup completed');
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
    return {
        isLoggedIn: !!apiInstance,
        hasSession: !!session,
        sessionType: session?.sessionType || 'none',
        userId: session?.userId || 'unknown',
        loginMethod: session?.loginMethod || 'none'
    };
}

export default { login, onMessage, sendMessage, getLoginStatus };
