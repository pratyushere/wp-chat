/**
 * WhatsApp Chat Parser
 * Handles multiple WhatsApp export formats across locales and devices.
 * Supports media file matching from zip exports.
 */

class WhatsAppParser {
    constructor() {
        // Various WhatsApp date/time patterns
        this.patterns = [
            // [DD/MM/YY, HH:MM:SS PM] Sender: Message
            /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]\s(.+?):\s([\s\S]*)/,
            // DD/MM/YY, HH:MM PM - Sender: Message
            /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\s[-–]\s(.+?):\s([\s\S]*)/,
            // DD/MM/YY, HH:MM - Sender: Message (no AM/PM)
            /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?)\s[-–]\s(.+?):\s([\s\S]*)/,
            // DD.MM.YY, HH:MM - Sender: Message (European dot format)
            /^(\d{1,2}\.\d{1,2}\.\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\s[-–]\s(.+?):\s([\s\S]*)/,
        ];

        // System message patterns (no sender)
        this.systemPatterns = [
            /^\[(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\]\s([\s\S]*)/,
            /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp][Mm])?)\s[-–]\s([\s\S]*)/,
        ];

        this.mediaPlaceholders = [
            '<Media omitted>',
            'image omitted',
            'video omitted',
            'audio omitted',
            'sticker omitted',
            'GIF omitted',
            'document omitted',
            'Contact card omitted',
        ];

        // Media file extensions
        this.imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
        this.videoExtensions = ['.mp4', '.3gp', '.mkv', '.avi', '.mov'];
        this.audioExtensions = ['.opus', '.mp3', '.m4a', '.aac', '.ogg', '.wav'];
        this.stickerExtensions = ['.webp'];
    }

    /**
     * Parse a WhatsApp chat export text string.
     * @param {string} text - Raw text from the .txt file
     * @param {Map<string, string>} mediaMap - Map of filename -> blob URL (optional)
     * @returns {object} Parsed chat data
     */
    parse(text, mediaMap = null) {
        // Normalize line endings
        text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

        // Remove BOM
        if (text.charCodeAt(0) === 0xFEFF) {
            text = text.slice(1);
        }

        // Remove invisible LTR/RTL marks that WhatsApp adds
        text = text.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');

        const lines = text.split('\n');
        const messages = [];
        const participants = new Map();
        let currentMessage = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trim()) continue;

            let parsed = this._tryParseMessage(line);

            if (parsed) {
                // Save previous message
                if (currentMessage) {
                    messages.push(currentMessage);
                }
                currentMessage = parsed;

                if (parsed.sender && parsed.type === 'message') {
                    const count = participants.get(parsed.sender) || 0;
                    participants.set(parsed.sender, count + 1);
                }
            } else if (currentMessage) {
                // Continuation of previous message (multi-line)
                currentMessage.text += '\n' + line;
            }
        }

        // Don't forget the last message
        if (currentMessage) {
            messages.push(currentMessage);
        }

        // Detect media in messages and resolve media files
        messages.forEach(msg => {
            if (msg.type === 'message') {
                const lowerText = msg.text.toLowerCase();
                msg.isMediaOmitted = this.mediaPlaceholders.some(p => lowerText.includes(p.toLowerCase()));

                // Try to find attached media references
                msg.media = this._detectMedia(msg.text, mediaMap);
                msg.isMedia = msg.isMediaOmitted || (msg.media && msg.media.length > 0);
            }
        });

        // Sort participants by message count (descending)
        const sortedParticipants = [...participants.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => ({ name, count }));

        return {
            messages,
            participants: sortedParticipants,
            totalMessages: messages.filter(m => m.type === 'message').length,
            dateRange: this._getDateRange(messages),
        };
    }

    /**
     * Detect and resolve media references in a message.
     * @param {string} text - The message text
     * @param {Map<string, string>} mediaMap - filename -> blob URL map
     * @returns {Array} Array of media objects { type, filename, url }
     */
    _detectMedia(text, mediaMap) {
        if (!mediaMap || mediaMap.size === 0) return [];

        const media = [];
        const cleanText = text.trim();

        // Pattern: <attached: FILENAME>
        const attachedPattern = /<attached:\s*(.+?)>/gi;
        let match;
        while ((match = attachedPattern.exec(cleanText)) !== null) {
            const filename = match[1].trim();
            const resolved = this._resolveMedia(filename, mediaMap);
            if (resolved) media.push(resolved);
        }

        // Pattern: FILENAME (file attached)
        const fileAttachedPattern = /^(.+?)\s*\(file attached\)\s*$/i;
        const faMatch = cleanText.match(fileAttachedPattern);
        if (faMatch) {
            const filename = faMatch[1].trim();
            const resolved = this._resolveMedia(filename, mediaMap);
            if (resolved) media.push(resolved);
        }

        // If no patterns matched, try matching the entire text as a filename
        if (media.length === 0) {
            const resolved = this._resolveMedia(cleanText, mediaMap);
            if (resolved) media.push(resolved);
        }

        // Also try to find any media filename mentioned in the text
        if (media.length === 0) {
            for (const [filename] of mediaMap) {
                // Skip the chat .txt file itself
                if (filename.endsWith('.txt')) continue;
                if (cleanText.includes(filename)) {
                    const resolved = this._resolveMedia(filename, mediaMap);
                    if (resolved) {
                        media.push(resolved);
                        break;
                    }
                }
            }
        }

        return media;
    }

    /**
     * Resolve a filename to a media object with type and URL.
     */
    _resolveMedia(filename, mediaMap) {
        if (!filename) return null;

        // Try exact match first
        let url = mediaMap.get(filename);

        // Try case-insensitive match
        if (!url) {
            const lowerFilename = filename.toLowerCase();
            for (const [key, value] of mediaMap) {
                if (key.toLowerCase() === lowerFilename) {
                    url = value;
                    break;
                }
            }
        }

        // Try partial match (filename without path)
        if (!url) {
            const baseName = filename.split('/').pop().split('\\').pop();
            for (const [key, value] of mediaMap) {
                const keyBase = key.split('/').pop().split('\\').pop();
                if (keyBase === baseName) {
                    url = value;
                    break;
                }
            }
        }

        if (!url) return null;

        const ext = ('.' + filename.split('.').pop()).toLowerCase();
        let type = 'file';

        if (this.imageExtensions.includes(ext)) type = 'image';
        else if (this.videoExtensions.includes(ext)) type = 'video';
        else if (this.audioExtensions.includes(ext)) type = 'audio';
        else if (ext === '.webp') type = 'sticker';

        return { type, filename, url };
    }

    _tryParseMessage(line) {
        // Try each message pattern (with sender)
        for (const pattern of this.patterns) {
            const match = line.match(pattern);
            if (match) {
                const dateStr = match[1];
                const timeStr = match[2];
                const sender = match[3].trim();
                const text = match[4];

                return {
                    type: 'message',
                    date: this._parseDate(dateStr, timeStr),
                    dateStr,
                    timeStr: this._formatTime(timeStr),
                    sender,
                    text,
                };
            }
        }

        // Try system message patterns (no sender)
        for (const pattern of this.systemPatterns) {
            const match = line.match(pattern);
            if (match) {
                const dateStr = match[1];
                const timeStr = match[2];
                const text = match[3];

                const systemKeywords = [
                    'created group', 'added', 'removed', 'changed', 'left',
                    'joined', 'end-to-end', 'encrypted', 'security code',
                    'disappearing messages', 'admin', 'description',
                    'Messages and calls are end-to-end encrypted',
                    'waiting for this message',
                    'You were added', 'You created',
                ];

                const isSystem = systemKeywords.some(kw =>
                    text.toLowerCase().includes(kw.toLowerCase())
                );

                if (isSystem) {
                    return {
                        type: 'system',
                        date: this._parseDate(dateStr, timeStr),
                        dateStr,
                        timeStr: this._formatTime(timeStr),
                        sender: null,
                        text,
                    };
                }
            }
        }

        return null;
    }

    _parseDate(dateStr, timeStr) {
        try {
            const parts = dateStr.split(/[\/\.]/);
            if (parts.length !== 3) return new Date();

            let day = parseInt(parts[0]);
            let month = parseInt(parts[1]) - 1;
            let year = parseInt(parts[2]);

            if (year < 100) {
                year += 2000;
            }

            let timeParts = timeStr.trim().replace(/\s+/g, ' ');
            let isPM = /pm/i.test(timeParts);
            let isAM = /am/i.test(timeParts);
            timeParts = timeParts.replace(/\s?[AaPp][Mm]/g, '').trim();

            const tParts = timeParts.split(':');
            let hours = parseInt(tParts[0]);
            const minutes = parseInt(tParts[1]);
            const seconds = tParts[2] ? parseInt(tParts[2]) : 0;

            if (isPM && hours !== 12) hours += 12;
            if (isAM && hours === 12) hours = 0;

            return new Date(year, month, day, hours, minutes, seconds);
        } catch {
            return new Date();
        }
    }

    _formatTime(timeStr) {
        return timeStr.trim().replace(/:\d{2}(?=\s|$)/, '').replace(/\s+/g, ' ');
    }

    _getDateRange(messages) {
        const dated = messages.filter(m => m.date && !isNaN(m.date.getTime()));
        if (dated.length === 0) return { start: null, end: null };
        return {
            start: dated[0].date,
            end: dated[dated.length - 1].date,
        };
    }
}

// Make globally available
window.WhatsAppParser = WhatsAppParser;
