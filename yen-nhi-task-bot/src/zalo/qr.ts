/**
 * zalo/qr.ts
 * QR Code management for web display on server environments like Render
 */
import fs from 'fs';
import path from 'path';

interface QRData {
    url?: string;
    base64?: string;
    timestamp: number;
}

let currentQR: QRData | null = null;

/**
 * Store QR data for web display
 */
export function storeQRData(qrData: any) {
    console.log('[QR DEBUG] Received qrData:', JSON.stringify(qrData, null, 2));

    if (qrData) {
        currentQR = {
            url: qrData.token,
            base64: qrData.image ? `data:image/png;base64,${qrData.image}` : undefined,
            timestamp: Date.now()
        };

        // Also save base64 as image file if available
        if (qrData.image) {
            try {
                const qrPath = path.join(process.cwd(), 'qr.png');
                fs.writeFileSync(qrPath, Buffer.from(qrData.image, 'base64'));
                console.log('[QR] ✅ Saved QR code to qr.png');
            } catch (err) {
                console.error('[QR] ❌ Error saving QR image:', err);
            }
        }
    }
}

/**
 * Get current QR data
 */
export function getCurrentQR(): QRData | null {
    // QR codes expire after 5 minutes
    if (currentQR && (Date.now() - currentQR.timestamp) > 5 * 60 * 1000) {
        currentQR = null;
    }
    return currentQR;
}

/**
 * Clear QR data (when login successful)
 */
export function clearQR() {
    currentQR = null;
    // Remove qr.png file
    try {
        const qrPath = path.join(process.cwd(), 'qr.png');
        if (fs.existsSync(qrPath)) {
            fs.unlinkSync(qrPath);
            console.log('[QR] Removed qr.png file');
        }
    } catch (err) {
        console.error('[QR] Error removing QR file:', err);
    }
}
