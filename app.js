/**
 * WhatsApp Chat Viewer - Main Application
 * Supports .txt and .zip uploads with inline media rendering.
 */

(function () {
    'use strict';

    // ========================
    // State
    // ========================
    let chatData = null;
    let selectedParticipant = null;
    let userSender = null;
    let mediaMap = new Map(); // filename -> blob URL

    // Color palette for participant avatars
    const AVATAR_COLORS = [
        '#00a884', '#53bdeb', '#e57373', '#f06292', '#ba68c8',
        '#7986cb', '#4fc3f7', '#4db6ac', '#aed581', '#ffd54f',
        '#ff8a65', '#a1887f', '#e091aa', '#7cb9a0', '#c49b5f',
    ];
    const participantColorMap = new Map();
    let colorIndex = 0;

    function getParticipantColor(name) {
        if (!participantColorMap.has(name)) {
            participantColorMap.set(name, AVATAR_COLORS[colorIndex % AVATAR_COLORS.length]);
            colorIndex++;
        }
        return participantColorMap.get(name);
    }

    // ========================
    // DOM References
    // ========================
    const uploadScreen = document.getElementById('upload-screen');
    const chatScreen = document.getElementById('chat-screen');
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const searchInput = document.getElementById('search-input');
    const chatInfo = document.getElementById('chat-info');
    const participantsList = document.getElementById('participants-list');
    const chatTitle = document.getElementById('chat-title');
    const chatSubtitle = document.getElementById('chat-subtitle');
    const headerAvatarLetter = document.getElementById('header-avatar-letter');
    const messagesContainer = document.getElementById('messages-container');
    const chatBody = document.getElementById('chat-body');
    const newUploadBtn = document.getElementById('new-upload-btn');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const sidebar = document.getElementById('sidebar');
    const statsBtn = document.getElementById('stats-btn');
    const statsModal = document.getElementById('stats-modal');
    const closeStats = document.getElementById('close-stats');
    const statsContent = document.getElementById('stats-content');
    const scrollBottomBtn = document.getElementById('scroll-bottom-btn');

    // ========================
    // File Upload Handling
    // ========================
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    fileInput.addEventListener('change', () => {
        const file = fileInput.files[0];
        if (file) handleFile(file);
    });

    async function handleFile(file) {
        const ext = file.name.split('.').pop().toLowerCase();

        if (ext !== 'txt' && ext !== 'zip') {
            alert('Please upload a .txt or .zip file exported from WhatsApp.');
            return;
        }

        showLoading('Reading file...');

        try {
            if (ext === 'zip') {
                await handleZipFile(file);
            } else {
                await handleTxtFile(file);
            }
        } catch (err) {
            hideLoading();
            console.error(err);
            alert('Error processing file: ' + err.message);
        }
    }

    /**
     * Handle a plain .txt file upload.
     */
    async function handleTxtFile(file) {
        const text = await readFileAsText(file);
        const parser = new WhatsAppParser();
        chatData = parser.parse(text);

        if (chatData.messages.length === 0) {
            hideLoading();
            alert('No messages found. Make sure this is a valid WhatsApp chat export.');
            return;
        }

        if (chatData.participants.length > 0) {
            userSender = chatData.participants[0].name;
        }

        initChatView();
    }

    /**
     * Handle a .zip file upload — extract media and chat text.
     */
    async function handleZipFile(file) {
        updateLoadingText('Extracting zip file...');

        const zip = await JSZip.loadAsync(file);
        const entries = Object.entries(zip.files);

        // Find the .txt chat file
        let chatTxtFile = null;
        const mediaFiles = [];

        for (const [path, zipEntry] of entries) {
            if (zipEntry.dir) continue;

            const filename = path.split('/').pop();
            const ext = filename.split('.').pop().toLowerCase();

            if (ext === 'txt' && !chatTxtFile) {
                // Prefer files with "WhatsApp" in name, or just the first .txt
                if (filename.toLowerCase().includes('whatsapp') || filename.toLowerCase().includes('chat')) {
                    chatTxtFile = zipEntry;
                } else if (!chatTxtFile) {
                    chatTxtFile = zipEntry;
                }
            } else {
                mediaFiles.push({ path, filename, zipEntry });
            }
        }

        // If no preferred txt found, take any txt
        if (!chatTxtFile) {
            for (const [path, zipEntry] of entries) {
                if (!zipEntry.dir && path.split('.').pop().toLowerCase() === 'txt') {
                    chatTxtFile = zipEntry;
                    break;
                }
            }
        }

        if (!chatTxtFile) {
            hideLoading();
            alert('No .txt chat file found in the zip. Make sure this is a valid WhatsApp chat export.');
            return;
        }

        // Extract media files and create blob URLs
        updateLoadingText(`Extracting ${mediaFiles.length} media files...`);

        // Clean up old blob URLs
        for (const url of mediaMap.values()) {
            URL.revokeObjectURL(url);
        }
        mediaMap.clear();

        let processedCount = 0;
        const totalMedia = mediaFiles.length;

        for (const { path, filename, zipEntry } of mediaFiles) {
            try {
                const blob = await zipEntry.async('blob');
                const ext = filename.split('.').pop().toLowerCase();

                // Set proper MIME type
                const mimeType = getMimeType(ext);
                const typedBlob = new Blob([blob], { type: mimeType });
                const blobUrl = URL.createObjectURL(typedBlob);

                // Store by filename (without path)
                mediaMap.set(filename, blobUrl);
                // Also store by full path
                mediaMap.set(path, blobUrl);
            } catch (e) {
                console.warn(`Failed to extract: ${filename}`, e);
            }

            processedCount++;
            if (processedCount % 20 === 0 || processedCount === totalMedia) {
                updateLoadingText(`Extracting media... ${processedCount}/${totalMedia}`);
            }
        }

        // Parse chat text
        updateLoadingText('Parsing messages...');
        const chatText = await chatTxtFile.async('string');
        const parser = new WhatsAppParser();
        chatData = parser.parse(chatText, mediaMap);

        if (chatData.messages.length === 0) {
            hideLoading();
            alert('No messages found in the chat file.');
            return;
        }

        if (chatData.participants.length > 0) {
            userSender = chatData.participants[0].name;
        }

        initChatView();
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsText(file);
        });
    }

    function getMimeType(ext) {
        const mimeTypes = {
            // Images
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
            gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
            // Videos
            mp4: 'video/mp4', '3gp': 'video/3gpp', mkv: 'video/x-matroska',
            avi: 'video/x-msvideo', mov: 'video/quicktime',
            // Audio
            opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4',
            aac: 'audio/aac', ogg: 'audio/ogg', wav: 'audio/wav',
            // Documents
            pdf: 'application/pdf', doc: 'application/msword',
            docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    // ========================
    // Loading Overlay
    // ========================
    function showLoading(text = 'Parsing your chat...') {
        let overlay = document.getElementById('loading-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.className = 'loading-overlay';
            overlay.id = 'loading-overlay';
            overlay.innerHTML = `
                <div class="spinner"></div>
                <p class="loading-text" id="loading-text">${text}</p>
            `;
            document.body.appendChild(overlay);
        }
    }

    function updateLoadingText(text) {
        const el = document.getElementById('loading-text');
        if (el) el.textContent = text;
    }

    function hideLoading() {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.remove();
    }

    // ========================
    // Initialize Chat View
    // ========================
    function initChatView() {
        uploadScreen.classList.remove('active');
        chatScreen.classList.add('active');

        populateSidebar();
        renderMessages();
        hideLoading();

        requestAnimationFrame(() => {
            chatBody.scrollTop = chatBody.scrollHeight;
        });
    }

    // ========================
    // Sidebar
    // ========================
    function populateSidebar() {
        const total = chatData.totalMessages;
        const startDate = chatData.dateRange.start
            ? chatData.dateRange.start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : '—';
        const endDate = chatData.dateRange.end
            ? chatData.dateRange.end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            : '—';

        const mediaCount = mediaMap.size;

        chatInfo.innerHTML = `
            <div class="info-row">
                <span class="info-label">Total Messages</span>
                <span class="info-value">${total.toLocaleString()}</span>
            </div>
            <div class="info-row">
                <span class="info-label">Participants</span>
                <span class="info-value">${chatData.participants.length}</span>
            </div>
            ${mediaCount > 0 ? `
            <div class="info-row">
                <span class="info-label">Media Files</span>
                <span class="info-value">${mediaCount.toLocaleString()}</span>
            </div>
            ` : ''}
            <div class="info-row">
                <span class="info-label">From</span>
                <span class="info-value">${startDate}</span>
            </div>
            <div class="info-row">
                <span class="info-label">To</span>
                <span class="info-value">${endDate}</span>
            </div>
        `;

        // Set header
        const isGroup = chatData.participants.length > 2;

        if (isGroup) {
            chatTitle.textContent = 'Group Chat';
            chatSubtitle.textContent = chatData.participants.map(p => p.name.split(' ')[0]).join(', ');
            headerAvatarLetter.textContent = 'G';
        } else if (chatData.participants.length === 2) {
            const otherPerson = chatData.participants.find(p => p.name !== userSender) || chatData.participants[0];
            chatTitle.textContent = otherPerson.name;
            chatSubtitle.textContent = `${total.toLocaleString()} messages`;
            headerAvatarLetter.textContent = otherPerson.name.charAt(0).toUpperCase();
        } else if (chatData.participants.length === 1) {
            chatTitle.textContent = chatData.participants[0].name;
            chatSubtitle.textContent = `${total.toLocaleString()} messages`;
            headerAvatarLetter.textContent = chatData.participants[0].name.charAt(0).toUpperCase();
        }

        // Participant list
        let html = `
            <div class="participant-item active" data-sender="__all__">
                <div class="participant-avatar" style="background: linear-gradient(135deg, #128c7e, #25d366);">
                    <span>A</span>
                </div>
                <div class="participant-details">
                    <div class="participant-name">All Messages</div>
                    <div class="participant-count">${total.toLocaleString()} messages</div>
                </div>
            </div>
        `;

        chatData.participants.forEach(p => {
            const color = getParticipantColor(p.name);
            const initial = p.name.charAt(0).toUpperCase();
            html += `
                <div class="participant-item" data-sender="${escapeHtml(p.name)}">
                    <div class="participant-avatar" style="background: ${color};">
                        <span>${initial}</span>
                    </div>
                    <div class="participant-details">
                        <div class="participant-name">${escapeHtml(p.name)}</div>
                        <div class="participant-count">${p.count.toLocaleString()} messages</div>
                    </div>
                </div>
            `;
        });

        participantsList.innerHTML = html;

        participantsList.querySelectorAll('.participant-item').forEach(item => {
            item.addEventListener('click', () => {
                participantsList.querySelectorAll('.participant-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                const sender = item.dataset.sender;
                selectedParticipant = sender === '__all__' ? null : sender;
                renderMessages();

                if (window.innerWidth <= 900) {
                    sidebar.classList.remove('open');
                }
            });
        });
    }

    // ========================
    // Message Rendering
    // ========================
    function renderMessages(searchTerm = '') {
        const fragment = document.createDocumentFragment();
        let lastDate = '';
        let lastSender = '';
        const search = searchTerm.toLowerCase().trim();

        let filtered = chatData.messages;

        if (selectedParticipant) {
            filtered = filtered.filter(m =>
                m.type === 'system' || m.sender === selectedParticipant
            );
        }

        if (search) {
            filtered = filtered.filter(m =>
                m.text && m.text.toLowerCase().includes(search)
            );
        }

        // Limit rendering for performance
        const MAX_RENDER = 5000;
        let limitedStart = 0;
        if (filtered.length > MAX_RENDER) {
            limitedStart = filtered.length - MAX_RENDER;
            const notice = document.createElement('div');
            notice.className = 'system-message';
            notice.innerHTML = `<span>Showing latest ${MAX_RENDER.toLocaleString()} of ${filtered.length.toLocaleString()} messages. Use search to find older messages.</span>`;
            fragment.appendChild(notice);
        }

        for (let i = limitedStart; i < filtered.length; i++) {
            const msg = filtered[i];
            const dateKey = msg.date ? msg.date.toLocaleDateString('en-IN', {
                day: 'numeric', month: 'long', year: 'numeric'
            }) : '';

            // Date separator
            if (dateKey && dateKey !== lastDate) {
                const sep = document.createElement('div');
                sep.className = 'date-separator';
                sep.innerHTML = `<span>${dateKey}</span>`;
                fragment.appendChild(sep);
                lastDate = dateKey;
                lastSender = '';
            }

            if (msg.type === 'system') {
                const el = document.createElement('div');
                el.className = 'system-message';
                el.innerHTML = `<span>${highlightSearch(escapeHtml(msg.text), search)}</span>`;
                fragment.appendChild(el);
                lastSender = '';
                continue;
            }

            // Message row
            const isOutgoing = msg.sender === userSender;
            const hasTail = msg.sender !== lastSender;
            const row = document.createElement('div');
            row.className = `message-row ${isOutgoing ? 'outgoing' : 'incoming'}${hasTail ? ' has-tail' : ''}`;

            const isGroup = chatData.participants.length > 2;
            const senderColor = getParticipantColor(msg.sender);

            let senderHtml = '';
            if (hasTail && !isOutgoing && isGroup) {
                senderHtml = `<span class="sender-name" style="color: ${senderColor}">${escapeHtml(msg.sender)}</span>`;
            }

            // Build media HTML
            let mediaHtml = '';
            if (msg.media && msg.media.length > 0) {
                mediaHtml = msg.media.map(m => renderMediaElement(m)).join('');
            }

            // Build text content
            let textContent = escapeHtml(msg.text);
            textContent = linkify(textContent);
            textContent = highlightSearch(textContent, search);

            // If message has inline media, clean up the filename references from text
            let displayText = textContent;
            if (msg.media && msg.media.length > 0) {
                // Remove the attachment indicators from display text
                displayText = displayText
                    .replace(/&lt;attached:\s*.+?&gt;/gi, '')
                    .replace(/\(file attached\)/gi, '')
                    .trim();

                // If text is just a filename, hide it entirely
                if (msg.media.some(m => {
                    const cleanText = msg.text.trim()
                        .replace(/<attached:\s*.+?>/gi, '')
                        .replace(/\(file attached\)/gi, '')
                        .trim();
                    return cleanText === '' || cleanText === m.filename;
                })) {
                    displayText = '';
                }
            }

            // Handle media-omitted messages
            if (msg.isMediaOmitted && (!msg.media || msg.media.length === 0)) {
                displayText = `<span style="font-style: italic; opacity: 0.7">📎 ${textContent}</span>`;
                mediaHtml = '';
            }

            const textSection = displayText
                ? `<span class="message-text">${displayText}</span>`
                : '';

            row.innerHTML = `
                <div class="message-bubble${mediaHtml ? ' has-media' : ''}">
                    ${senderHtml}
                    ${mediaHtml}
                    ${textSection}
                    <span class="message-meta">
                        <span class="message-time">${escapeHtml(msg.timeStr)}</span>
                    </span>
                </div>
            `;

            fragment.appendChild(row);
            lastSender = msg.sender;
        }

        messagesContainer.innerHTML = '';
        messagesContainer.appendChild(fragment);

        // Add click-to-expand for images
        messagesContainer.querySelectorAll('.media-image').forEach(img => {
            img.addEventListener('click', () => openImageViewer(img.src));
        });

        if (!search) {
            requestAnimationFrame(() => {
                chatBody.scrollTop = chatBody.scrollHeight;
            });
        }
    }

    /**
     * Render a media element (image, video, audio, sticker) as HTML.
     */
    function renderMediaElement(media) {
        switch (media.type) {
            case 'image':
                return `<div class="media-container"><img class="media-image" src="${media.url}" alt="${escapeHtml(media.filename)}" loading="lazy"></div>`;

            case 'sticker':
                return `<div class="media-container sticker-container"><img class="media-sticker" src="${media.url}" alt="Sticker" loading="lazy"></div>`;

            case 'video':
                return `<div class="media-container"><video class="media-video" src="${media.url}" controls preload="metadata" playsinline></video></div>`;

            case 'audio':
                return `<div class="media-container audio-container"><div class="audio-icon">🎵</div><audio class="media-audio" src="${media.url}" controls preload="metadata"></audio></div>`;

            default:
                return `<div class="media-container file-container"><a class="media-file-link" href="${media.url}" download="${escapeHtml(media.filename)}">📄 ${escapeHtml(media.filename)}</a></div>`;
        }
    }

    // ========================
    // Image Viewer (Lightbox)
    // ========================
    function openImageViewer(src) {
        const overlay = document.createElement('div');
        overlay.className = 'image-viewer-overlay';
        overlay.innerHTML = `
            <div class="image-viewer-close">&times;</div>
            <img class="image-viewer-img" src="${src}" alt="Full size">
        `;
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.classList.contains('image-viewer-close')) {
                overlay.remove();
            }
        });
        document.body.appendChild(overlay);

        requestAnimationFrame(() => overlay.classList.add('active'));
    }

    // ========================
    // Search
    // ========================
    let searchTimeout;
    searchInput.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            renderMessages(searchInput.value);
        }, 300);
    });

    // ========================
    // Stats
    // ========================
    statsBtn.addEventListener('click', () => {
        renderStats();
        statsModal.classList.add('active');
    });

    closeStats.addEventListener('click', () => {
        statsModal.classList.remove('active');
    });

    statsModal.addEventListener('click', (e) => {
        if (e.target === statsModal) {
            statsModal.classList.remove('active');
        }
    });

    function renderStats() {
        if (!chatData) return;

        const msgs = chatData.messages.filter(m => m.type === 'message');
        const totalWords = msgs.reduce((sum, m) => sum + m.text.split(/\s+/).filter(Boolean).length, 0);
        const totalMedia = msgs.filter(m => m.isMedia).length;

        const daysSet = new Set();
        msgs.forEach(m => {
            if (m.date) daysSet.add(m.date.toDateString());
        });
        const avgPerDay = daysSet.size > 0 ? Math.round(msgs.length / daysSet.size) : 0;

        // ========================
        // Summary Cards
        // ========================
        let html = `
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${msgs.length.toLocaleString()}</div>
                    <div class="stat-label">Messages</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${totalWords.toLocaleString()}</div>
                    <div class="stat-label">Words</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${totalMedia.toLocaleString()}</div>
                    <div class="stat-label">Media Shared</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${avgPerDay}</div>
                    <div class="stat-label">Avg / Day</div>
                </div>
            </div>
        `;

        // ========================
        // Messages by Participant
        // ========================
        html += `<div class="stats-section-title">Messages by Participant</div>`;
        const maxCount = chatData.participants.length > 0 ? chatData.participants[0].count : 1;

        chatData.participants.forEach(p => {
            const pct = ((p.count / msgs.length) * 100).toFixed(1);
            const barWidth = ((p.count / maxCount) * 100).toFixed(1);
            const color = getParticipantColor(p.name);
            html += `
                <div class="stats-bar-container">
                    <div class="stats-bar-label">
                        <span>${escapeHtml(p.name)}</span>
                        <span>${p.count.toLocaleString()} (${pct}%)</span>
                    </div>
                    <div class="stats-bar-track">
                        <div class="stats-bar-fill" style="width: ${barWidth}%; background: ${color};"></div>
                    </div>
                </div>
            `;
        });

        // ========================
        // Response Time & Longest Streak (side by side)
        // ========================
        const responseTimeData = computeResponseTimes(msgs);
        const streakData = computeLongestStreak(msgs);

        html += `<div class="insight-cards">`;

        // Response Time Card
        html += `
            <div class="insight-card">
                <div class="insight-card-header">
                    <span class="insight-card-icon">⚡</span>
                    <span class="insight-card-title">Avg Response Time</span>
                </div>
                <div class="response-time-list">
        `;

        responseTimeData.forEach(rt => {
            const color = getParticipantColor(rt.name);
            html += `
                <div class="response-time-row">
                    <span class="response-time-name">
                        <span class="response-time-dot" style="background: ${color};"></span>
                        ${escapeHtml(rt.name.split(' ')[0])}
                    </span>
                    <span class="response-time-value">${rt.formatted}</span>
                </div>
            `;
        });

        html += `</div></div>`;

        // Streak Card
        html += `
            <div class="insight-card">
                <div class="insight-card-header">
                    <span class="insight-card-icon">🔥</span>
                    <span class="insight-card-title">Longest Streak</span>
                </div>
                <div class="insight-big-value">${streakData.length} days</div>
                <div class="insight-sub">${streakData.startStr} — ${streakData.endStr}</div>
                <div class="streak-detail">Current streak: ${streakData.currentStreak} day${streakData.currentStreak !== 1 ? 's' : ''}</div>
            </div>
        `;

        html += `</div>`;

        // ========================
        // Who Texts First?
        // ========================
        html += `<div class="stats-section-title">🏆 Who Texts First?</div>`;
        html += buildConversationInitiator(msgs);

        // ========================
        // Night Owl vs Early Bird
        // ========================
        html += `<div class="stats-section-title">🌙 Night Owl vs Early Bird</div>`;
        html += buildTimeOfDay(msgs);

        // ========================
        // Top Emojis
        // ========================
        html += `<div class="stats-section-title">😂 Top Emojis</div>`;
        html += buildTopEmojis(msgs);

        // ========================
        // Avg Message Length
        // ========================
        html += `<div class="stats-section-title">📝 Avg Message Length</div>`;
        html += buildAvgMessageLength(msgs);

        // ========================
        // Most Active Day & Longest Silence (side by side)
        // ========================
        const mostActiveDay = computeMostActiveDay(msgs);
        const longestSilence = computeLongestSilence(msgs);

        html += `<div class="insight-cards">`;
        html += `
            <div class="insight-card">
                <div class="insight-card-header">
                    <span class="insight-card-icon">💬</span>
                    <span class="insight-card-title">Most Active Day</span>
                </div>
                <div class="insight-big-value">${mostActiveDay.count.toLocaleString()}</div>
                <div class="insight-sub">messages on ${mostActiveDay.dateStr}</div>
            </div>
        `;
        html += `
            <div class="insight-card">
                <div class="insight-card-header">
                    <span class="insight-card-icon">🔇</span>
                    <span class="insight-card-title">Longest Silence</span>
                </div>
                <div class="insight-big-value">${longestSilence.formatted}</div>
                <div class="insight-sub">${longestSilence.fromStr} — ${longestSilence.toStr}</div>
            </div>
        `;
        html += `</div>`;

        // ========================
        // Week-over-Week Growth
        // ========================
        html += `<div class="stats-section-title">📈 Week-over-Week Trend</div>`;
        html += buildWoWTrend(msgs);

        // ========================
        // Links Shared
        // ========================
        html += `<div class="stats-section-title">🔗 Links Shared</div>`;
        html += buildLinksShared(msgs);

        // ========================
        // Activity Heatmap
        // ========================
        html += `<div class="stats-section-title">Activity Heatmap</div>`;
        html += buildHeatmap(msgs);

        // ========================
        // Hourly Activity
        // ========================
        html += `<div class="stats-section-title">Hourly Activity</div>`;
        html += buildHourlyChart(msgs);

        // ========================
        // Monthly Trend
        // ========================
        html += `<div class="stats-section-title">Monthly Trend</div>`;
        html += buildMonthlyTrend(msgs);

        // ========================
        // Stacked Monthly Chart
        // ========================
        html += `<div class="stats-section-title">📊 Messages per Month (by Person)</div>`;
        html += buildStackedMonthlyChart(msgs);

        // ========================
        // Day of Week
        // ========================
        const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0];
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        msgs.forEach(m => {
            if (m.date) dayOfWeekCounts[m.date.getDay()]++;
        });
        const maxDayCount = Math.max(...dayOfWeekCounts);

        html += `<div class="stats-section-title">Activity by Day of Week</div>`;
        dayOfWeekCounts.forEach((count, idx) => {
            const barWidth = maxDayCount > 0 ? ((count / maxDayCount) * 100).toFixed(1) : 0;
            html += `
                <div class="stats-bar-container">
                    <div class="stats-bar-label">
                        <span>${dayNames[idx]}</span>
                        <span>${count.toLocaleString()}</span>
                    </div>
                    <div class="stats-bar-track">
                        <div class="stats-bar-fill" style="width: ${barWidth}%; background: linear-gradient(90deg, #25d366, #128c7e);"></div>
                    </div>
                </div>
            `;
        });

        statsContent.innerHTML = html;
    }

    // ========================
    // Analytics: Who Texts First
    // ========================
    function buildConversationInitiator(msgs) {
        const GAP_THRESHOLD = 6 * 60 * 60 * 1000; // 6 hours = new conversation
        const initiatorCounts = new Map();

        for (let i = 0; i < msgs.length; i++) {
            if (!msgs[i].sender || !msgs[i].date) continue;

            if (i === 0) {
                initiatorCounts.set(msgs[i].sender, (initiatorCounts.get(msgs[i].sender) || 0) + 1);
                continue;
            }

            if (!msgs[i - 1].date) continue;
            const gap = msgs[i].date.getTime() - msgs[i - 1].date.getTime();
            if (gap >= GAP_THRESHOLD) {
                initiatorCounts.set(msgs[i].sender, (initiatorCounts.get(msgs[i].sender) || 0) + 1);
            }
        }

        const total = [...initiatorCounts.values()].reduce((a, b) => a + b, 0);
        if (total === 0) return '<p style="color:var(--wa-text-secondary);font-size:0.8rem;">Not enough data</p>';

        const sorted = [...initiatorCounts.entries()].sort((a, b) => b[1] - a[1]);
        const maxInit = sorted[0][1];

        let html = '<div class="initiator-bars">';
        sorted.forEach(([name, count]) => {
            const pct = ((count / total) * 100).toFixed(0);
            const barWidth = ((count / maxInit) * 100).toFixed(1);
            const color = getParticipantColor(name);
            html += `
                <div class="initiator-row">
                    <span class="initiator-name">${escapeHtml(name.split(' ')[0])}</span>
                    <div class="initiator-bar-track">
                        <div class="initiator-bar-fill" style="width: ${barWidth}%; background: ${color};">
                            <span class="initiator-bar-text">${count} (${pct}%)</span>
                        </div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        return html;
    }

    // ========================
    // Analytics: Night Owl vs Early Bird
    // ========================
    function buildTimeOfDay(msgs) {
        const buckets = [
            { label: 'Morning', icon: '🌅', range: '6 AM – 12 PM', start: 6, end: 12 },
            { label: 'Afternoon', icon: '☀️', range: '12 PM – 6 PM', start: 12, end: 18 },
            { label: 'Evening', icon: '🌆', range: '6 PM – 12 AM', start: 18, end: 24 },
            { label: 'Night', icon: '🌙', range: '12 AM – 6 AM', start: 0, end: 6 },
        ];

        // Count per bucket and per person
        const bucketCounts = buckets.map(() => ({ total: 0, perPerson: new Map() }));

        msgs.forEach(m => {
            if (!m.date || !m.sender) return;
            const hour = m.date.getHours();
            for (let b = 0; b < buckets.length; b++) {
                const { start, end } = buckets[b];
                if (hour >= start && hour < end) {
                    bucketCounts[b].total++;
                    bucketCounts[b].perPerson.set(m.sender, (bucketCounts[b].perPerson.get(m.sender) || 0) + 1);
                    break;
                }
            }
        });

        const totalMsgs = msgs.filter(m => m.date).length || 1;

        let html = '<div class="time-of-day-grid">';
        buckets.forEach((bucket, idx) => {
            const data = bucketCounts[idx];
            const pct = ((data.total / totalMsgs) * 100).toFixed(0);

            // Top person in this slot
            const sortedPeople = [...data.perPerson.entries()].sort((a, b) => b[1] - a[1]);

            html += `
                <div class="tod-card">
                    <div class="tod-icon">${bucket.icon}</div>
                    <div class="tod-label">${bucket.label} · ${bucket.range}</div>
                    <div class="tod-value">${data.total.toLocaleString()} <span class="tod-sub">(${pct}%)</span></div>
                    <div class="tod-breakdown">
            `;
            sortedPeople.slice(0, 3).forEach(([name, count]) => {
                const color = getParticipantColor(name);
                html += `
                    <div class="tod-person-row">
                        <span class="tod-person-name"><span class="response-time-dot" style="background:${color};"></span>${escapeHtml(name.split(' ')[0])}</span>
                        <span class="tod-person-count">${count.toLocaleString()}</span>
                    </div>
                `;
            });
            html += '</div></div>';
        });
        html += '</div>';
        return html;
    }

    // ========================
    // Analytics: Top Emojis
    // ========================
    function buildTopEmojis(msgs) {
        const emojiRegex = /(?:\p{Emoji_Presentation}|\p{Emoji}\uFE0F)/gu;
        const perPerson = new Map();

        msgs.forEach(m => {
            if (!m.sender || !m.text) return;
            const emojis = m.text.match(emojiRegex);
            if (!emojis) return;

            if (!perPerson.has(m.sender)) perPerson.set(m.sender, new Map());
            const emojiMap = perPerson.get(m.sender);
            emojis.forEach(e => {
                emojiMap.set(e, (emojiMap.get(e) || 0) + 1);
            });
        });

        if (perPerson.size === 0) return '<p style="color:var(--wa-text-secondary);font-size:0.8rem;">No emojis found</p>';

        let html = '<div class="emoji-grid">';
        for (const [name, emojiMap] of perPerson) {
            const color = getParticipantColor(name);
            const top10 = [...emojiMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
            html += `
                <div class="emoji-person">
                    <div class="emoji-person-name"><span class="response-time-dot" style="background:${color};"></span>${escapeHtml(name.split(' ')[0])}</div>
                    <div class="emoji-list">
            `;
            top10.forEach(([emoji, count]) => {
                html += `<div class="emoji-chip"><span class="emoji-chip-emoji">${emoji}</span><span class="emoji-chip-count">${count}</span></div>`;
            });
            html += '</div></div>';
        }
        html += '</div>';
        return html;
    }

    // ========================
    // Analytics: Avg Message Length
    // ========================
    function buildAvgMessageLength(msgs) {
        const perPerson = new Map();

        msgs.forEach(m => {
            if (!m.sender || !m.text) return;
            const wordCount = m.text.split(/\s+/).filter(Boolean).length;
            if (!perPerson.has(m.sender)) perPerson.set(m.sender, { totalWords: 0, count: 0 });
            const data = perPerson.get(m.sender);
            data.totalWords += wordCount;
            data.count++;
        });

        const results = [...perPerson.entries()].map(([name, data]) => ({
            name,
            avg: data.count > 0 ? data.totalWords / data.count : 0,
            totalWords: data.totalWords,
        })).sort((a, b) => b.avg - a.avg);

        if (results.length === 0) return '';
        const maxAvg = results[0].avg || 1;

        let html = '<div class="msg-length-grid">';
        results.forEach(r => {
            const color = getParticipantColor(r.name);
            const barWidth = ((r.avg / maxAvg) * 100).toFixed(1);
            html += `
                <div class="msg-length-row">
                    <span class="msg-length-name">${escapeHtml(r.name.split(' ')[0])}</span>
                    <div class="msg-length-bar-track">
                        <div class="msg-length-bar-fill" style="width: ${barWidth}%; background: ${color};"></div>
                    </div>
                    <span class="msg-length-value">${r.avg.toFixed(1)} words/msg</span>
                </div>
            `;
        });
        html += '</div>';
        return html;
    }

    // ========================
    // Analytics: Most Active Day
    // ========================
    function computeMostActiveDay(msgs) {
        const dayCounts = new Map();
        msgs.forEach(m => {
            if (m.date) {
                const key = m.date.toDateString();
                dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
            }
        });

        let maxDay = '', maxCount = 0;
        for (const [day, count] of dayCounts) {
            if (count > maxCount) {
                maxCount = count;
                maxDay = day;
            }
        }

        return {
            count: maxCount,
            dateStr: maxDay ? new Date(maxDay).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) : '—',
        };
    }

    // ========================
    // Analytics: Longest Silence
    // ========================
    function computeLongestSilence(msgs) {
        let maxGap = 0, maxFrom = null, maxTo = null;

        for (let i = 1; i < msgs.length; i++) {
            if (!msgs[i].date || !msgs[i - 1].date) continue;
            const gap = msgs[i].date.getTime() - msgs[i - 1].date.getTime();
            if (gap > maxGap) {
                maxGap = gap;
                maxFrom = msgs[i - 1].date;
                maxTo = msgs[i].date;
            }
        }

        const fmt = (d) => d ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

        return {
            ms: maxGap,
            formatted: formatDuration(maxGap),
            fromStr: fmt(maxFrom),
            toStr: fmt(maxTo),
        };
    }

    // ========================
    // Analytics: Week-over-Week Trend
    // ========================
    function buildWoWTrend(msgs) {
        // Compare the last 4 weeks vs the 4 weeks before that
        const now = new Date();
        const msPerWeek = 7 * 24 * 60 * 60 * 1000;

        const recentStart = new Date(now.getTime() - 4 * msPerWeek);
        const previousStart = new Date(now.getTime() - 8 * msPerWeek);

        let recentCount = 0, previousCount = 0;

        msgs.forEach(m => {
            if (!m.date) return;
            const t = m.date.getTime();
            if (t >= recentStart.getTime() && t <= now.getTime()) recentCount++;
            else if (t >= previousStart.getTime() && t < recentStart.getTime()) previousCount++;
        });

        let pctChange = 0;
        let direction = 'flat';
        if (previousCount > 0) {
            pctChange = ((recentCount - previousCount) / previousCount * 100);
            direction = pctChange > 5 ? 'up' : pctChange < -5 ? 'down' : 'flat';
        } else if (recentCount > 0) {
            direction = 'up';
            pctChange = 100;
        }

        const arrow = direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→';
        const sign = pctChange > 0 ? '+' : '';

        return `
            <div class="wow-indicator">
                <div class="wow-arrow ${direction}">${arrow}</div>
                <div class="wow-details">
                    <div class="wow-pct ${direction}">${sign}${pctChange.toFixed(0)}%</div>
                    <div class="wow-label">Last 4 weeks (${recentCount.toLocaleString()}) vs previous 4 weeks (${previousCount.toLocaleString()})</div>
                </div>
            </div>
        `;
    }

    // ========================
    // Analytics: Links Shared
    // ========================
    function buildLinksShared(msgs) {
        const urlRegex = /https?:\/\/[^\s<]+/gi;
        const perPerson = new Map();
        const domainCounts = new Map();
        let totalLinks = 0;

        msgs.forEach(m => {
            if (!m.sender || !m.text) return;
            const urls = m.text.match(urlRegex);
            if (!urls) return;

            perPerson.set(m.sender, (perPerson.get(m.sender) || 0) + urls.length);
            totalLinks += urls.length;

            urls.forEach(url => {
                try {
                    const domain = new URL(url).hostname.replace('www.', '');
                    domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
                } catch {}
            });
        });

        if (totalLinks === 0) return '<p style="color:var(--wa-text-secondary);font-size:0.8rem;">No links shared</p>';

        let html = `<div class="links-summary">`;

        // Per person
        const sorted = [...perPerson.entries()].sort((a, b) => b[1] - a[1]);
        sorted.forEach(([name, count]) => {
            const color = getParticipantColor(name);
            html += `
                <div class="links-person-row">
                    <span class="links-person-name"><span class="response-time-dot" style="background:${color};"></span>${escapeHtml(name.split(' ')[0])}</span>
                    <span class="links-person-count">${count} link${count !== 1 ? 's' : ''}</span>
                </div>
            `;
        });
        html += '</div>';

        // Top domains
        const topDomains = [...domainCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
        if (topDomains.length > 0) {
            html += '<div class="top-domains"><div class="top-domains-title">Top domains</div>';
            topDomains.forEach(([domain, count]) => {
                html += `<span class="domain-chip">🌐 ${escapeHtml(domain)} <span class="domain-count">(${count})</span></span>`;
            });
            html += '</div>';
        }

        return html;
    }

    // ========================
    // Analytics: Stacked Monthly Chart
    // ========================
    function buildStackedMonthlyChart(msgs) {
        const monthlyPerPerson = new Map(); // month -> Map(person -> count)
        const allMonths = new Set();

        msgs.forEach(m => {
            if (!m.date || !m.sender) return;
            const key = `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}`;
            allMonths.add(key);
            if (!monthlyPerPerson.has(key)) monthlyPerPerson.set(key, new Map());
            const pm = monthlyPerPerson.get(key);
            pm.set(m.sender, (pm.get(m.sender) || 0) + 1);
        });

        if (allMonths.size < 2) return '<p style="color:var(--wa-text-secondary);font-size:0.8rem;">Need at least 2 months of data</p>';

        const sortedMonths = [...allMonths].sort();
        // Limit to last 24 months
        const displayMonths = sortedMonths.slice(-24);
        const participants = chatData.participants.map(p => p.name);

        // Find max total for scaling
        let maxTotal = 0;
        displayMonths.forEach(month => {
            const pm = monthlyPerPerson.get(month) || new Map();
            const total = [...pm.values()].reduce((a, b) => a + b, 0);
            if (total > maxTotal) maxTotal = total;
        });

        if (maxTotal === 0) maxTotal = 1;

        let html = '<div class="stacked-chart">';
        displayMonths.forEach(month => {
            const pm = monthlyPerPerson.get(month) || new Map();
            const total = [...pm.values()].reduce((a, b) => a + b, 0);
            const totalPct = ((total / maxTotal) * 100).toFixed(1);

            const [y, m] = month.split('-');
            const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

            // Build tooltip
            let tooltipParts = [`${label}: ${total}`];
            participants.forEach(p => {
                const c = pm.get(p) || 0;
                if (c > 0) tooltipParts.push(`${p.split(' ')[0]}: ${c}`);
            });

            html += `<div class="stacked-bar-wrapper" style="height: ${totalPct}%;">`;
            html += `<span class="stacked-bar-tooltip">${tooltipParts.join(' · ')}</span>`;

            // Segments for each participant
            if (total > 0) {
                participants.forEach(p => {
                    const c = pm.get(p) || 0;
                    if (c === 0) return;
                    const segPct = ((c / total) * 100).toFixed(1);
                    const color = getParticipantColor(p);
                    html += `<div class="stacked-segment" style="height: ${segPct}%; background: ${color};"></div>`;
                });
            }

            html += '</div>';
        });
        html += '</div>';

        // Month labels (show subset)
        const step = Math.max(1, Math.floor(displayMonths.length / 12));
        html += '<div class="stacked-labels">';
        displayMonths.forEach((month, idx) => {
            if (idx % step === 0) {
                const [y, m] = month.split('-');
                const label = new Date(parseInt(y), parseInt(m) - 1).toLocaleDateString('en-US', { month: 'short' });
                html += `<div class="stacked-label">${label}</div>`;
            } else {
                html += `<div class="stacked-label"></div>`;
            }
        });
        html += '</div>';

        return html;
    }

    // ========================
    // Analytics: Response Time
    // ========================
    function computeResponseTimes(msgs) {
        if (msgs.length < 2) return [];

        const responseTimes = new Map(); // sender -> [durations in ms]

        for (let i = 1; i < msgs.length; i++) {
            const prev = msgs[i - 1];
            const curr = msgs[i];

            if (!prev.date || !curr.date || !prev.sender || !curr.sender) continue;
            if (prev.sender === curr.sender) continue;

            const diff = curr.date.getTime() - prev.date.getTime();
            // Only count responses within 24 hours (ignore overnight gaps)
            if (diff > 0 && diff < 24 * 60 * 60 * 1000) {
                if (!responseTimes.has(curr.sender)) {
                    responseTimes.set(curr.sender, []);
                }
                responseTimes.get(curr.sender).push(diff);
            }
        }

        const results = [];
        for (const [name, times] of responseTimes) {
            if (times.length === 0) continue;
            const avg = times.reduce((a, b) => a + b, 0) / times.length;
            results.push({
                name,
                avgMs: avg,
                formatted: formatDuration(avg),
            });
        }

        results.sort((a, b) => a.avgMs - b.avgMs);
        return results;
    }

    function formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        if (seconds < 60) return `${seconds}s`;
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ${minutes % 60}m`;
        const days = Math.floor(hours / 24);
        return `${days}d ${hours % 24}h`;
    }

    // ========================
    // Analytics: Longest Streak
    // ========================
    function computeLongestStreak(msgs) {
        const daysWithMessages = new Set();
        msgs.forEach(m => {
            if (m.date) {
                const d = new Date(m.date);
                d.setHours(0, 0, 0, 0);
                daysWithMessages.add(d.getTime());
            }
        });

        if (daysWithMessages.size === 0) {
            return { length: 0, startStr: '—', endStr: '—', currentStreak: 0 };
        }

        const sortedDays = [...daysWithMessages].sort((a, b) => a - b);
        const oneDay = 24 * 60 * 60 * 1000;

        let maxStreak = 1, currentStreak = 1;
        let maxStart = sortedDays[0], maxEnd = sortedDays[0];
        let curStart = sortedDays[0];

        for (let i = 1; i < sortedDays.length; i++) {
            if (sortedDays[i] - sortedDays[i - 1] === oneDay) {
                currentStreak++;
            } else {
                if (currentStreak > maxStreak) {
                    maxStreak = currentStreak;
                    maxStart = curStart;
                    maxEnd = sortedDays[i - 1];
                }
                currentStreak = 1;
                curStart = sortedDays[i];
            }
        }
        if (currentStreak > maxStreak) {
            maxStreak = currentStreak;
            maxStart = curStart;
            maxEnd = sortedDays[sortedDays.length - 1];
        }

        // Current streak (from today backwards)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        let liveStreak = 0;
        let checkDay = today.getTime();

        // Check today and yesterday as starting points
        if (daysWithMessages.has(checkDay)) {
            liveStreak = 1;
            checkDay -= oneDay;
            while (daysWithMessages.has(checkDay)) {
                liveStreak++;
                checkDay -= oneDay;
            }
        } else {
            checkDay -= oneDay; // Check from yesterday
            if (daysWithMessages.has(checkDay)) {
                liveStreak = 1;
                checkDay -= oneDay;
                while (daysWithMessages.has(checkDay)) {
                    liveStreak++;
                    checkDay -= oneDay;
                }
            }
        }

        const fmt = (ts) => new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

        return {
            length: maxStreak,
            startStr: fmt(maxStart),
            endStr: fmt(maxEnd),
            currentStreak: liveStreak,
        };
    }

    // ========================
    // Analytics: Activity Heatmap
    // ========================
    function buildHeatmap(msgs) {
        // Collect daily counts
        const dailyCounts = new Map();
        msgs.forEach(m => {
            if (m.date) {
                const key = m.date.toISOString().split('T')[0];
                dailyCounts.set(key, (dailyCounts.get(key) || 0) + 1);
            }
        });

        if (dailyCounts.size === 0) return '<p style="color:var(--wa-text-secondary);font-size:0.8rem;">No data</p>';

        // Get date range — show last 365 days or full range, whichever is smaller
        const now = new Date();
        const oneYear = 365;
        const startDate = new Date(now);
        startDate.setDate(startDate.getDate() - oneYear);
        startDate.setDate(startDate.getDate() - startDate.getDay()); // Align to Sunday

        // Find max for color scaling
        const counts = [...dailyCounts.values()];
        const maxVal = Math.max(...counts, 1);
        const q1 = maxVal * 0.25;
        const q2 = maxVal * 0.5;
        const q3 = maxVal * 0.75;

        // Build weeks
        let html = '<div class="heatmap-wrapper"><div class="heatmap-container">';
        const d = new Date(startDate);
        const monthLabels = [];
        let lastMonth = -1;

        while (d <= now) {
            html += '<div class="heatmap-week">';
            for (let dow = 0; dow < 7; dow++) {
                if (d > now) {
                    html += '<div class="heatmap-cell heatmap-level-0"></div>';
                } else {
                    const key = d.toISOString().split('T')[0];
                    const count = dailyCounts.get(key) || 0;
                    let level = 0;
                    if (count > 0) level = count <= q1 ? 1 : count <= q2 ? 2 : count <= q3 ? 3 : 4;

                    const dateLabel = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
                    const tooltip = `${dateLabel}: ${count} message${count !== 1 ? 's' : ''}`;

                    html += `<div class="heatmap-cell heatmap-level-${level}" data-tooltip="${tooltip}"></div>`;

                    // Track month labels
                    if (d.getMonth() !== lastMonth && dow === 0) {
                        monthLabels.push({
                            label: d.toLocaleDateString('en-US', { month: 'short' }),
                            weekIndex: Math.floor((d - startDate) / (7 * 24 * 60 * 60 * 1000))
                        });
                        lastMonth = d.getMonth();
                    }
                }
                d.setDate(d.getDate() + 1);
            }
            html += '</div>';
        }
        html += '</div>';

        // Legend
        html += `
            <div class="heatmap-legend">
                <span>Less</span>
                <div class="heatmap-legend-cell heatmap-level-0"></div>
                <div class="heatmap-legend-cell heatmap-level-1"></div>
                <div class="heatmap-legend-cell heatmap-level-2"></div>
                <div class="heatmap-legend-cell heatmap-level-3"></div>
                <div class="heatmap-legend-cell heatmap-level-4"></div>
                <span>More</span>
            </div>
        </div>`;

        return html;
    }

    // ========================
    // Analytics: Hourly Activity
    // ========================
    function buildHourlyChart(msgs) {
        const hourlyCounts = new Array(24).fill(0);
        msgs.forEach(m => {
            if (m.date) hourlyCounts[m.date.getHours()]++;
        });

        const maxHourly = Math.max(...hourlyCounts, 1);

        let html = '<div class="hourly-chart">';
        hourlyCounts.forEach((count, hour) => {
            const heightPct = ((count / maxHourly) * 100).toFixed(1);
            const label = hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
            html += `
                <div class="hourly-bar-wrapper">
                    <span class="hourly-bar-tooltip">${label}: ${count.toLocaleString()}</span>
                    <div class="hourly-bar" style="height: ${heightPct}%;"></div>
                </div>
            `;
        });
        html += '</div>';

        // Labels (show every 3 hours)
        html += '<div class="hourly-labels">';
        for (let h = 0; h < 24; h++) {
            const label = h % 3 === 0 ? (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`) : '';
            html += `<div class="hourly-label">${label}</div>`;
        }
        html += '</div>';

        return html;
    }

    // ========================
    // Analytics: Monthly Trend
    // ========================
    function buildMonthlyTrend(msgs) {
        const monthlyCounts = new Map();
        msgs.forEach(m => {
            if (m.date) {
                const key = `${m.date.getFullYear()}-${String(m.date.getMonth() + 1).padStart(2, '0')}`;
                monthlyCounts.set(key, (monthlyCounts.get(key) || 0) + 1);
            }
        });

        if (monthlyCounts.size < 2) {
            return '<p style="color:var(--wa-text-secondary);font-size:0.8rem;">Need at least 2 months of data</p>';
        }

        const sortedMonths = [...monthlyCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
        const values = sortedMonths.map(([, v]) => v);
        const labels = sortedMonths.map(([k]) => {
            const [y, m] = k.split('-');
            const date = new Date(parseInt(y), parseInt(m) - 1);
            return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
        });

        const maxVal = Math.max(...values, 1);
        const svgWidth = 650;
        const svgHeight = 130;
        const padding = { top: 10, right: 10, bottom: 5, left: 10 };
        const chartWidth = svgWidth - padding.left - padding.right;
        const chartHeight = svgHeight - padding.top - padding.bottom;

        const points = values.map((v, i) => {
            const x = padding.left + (i / (values.length - 1)) * chartWidth;
            const y = padding.top + chartHeight - (v / maxVal) * chartHeight;
            return { x, y, value: v, label: labels[i] };
        });

        // Build SVG path
        const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
        const areaPath = linePath + ` L ${points[points.length - 1].x.toFixed(1)} ${svgHeight - padding.bottom} L ${points[0].x.toFixed(1)} ${svgHeight - padding.bottom} Z`;

        let html = `
            <div class="trend-chart-container">
                <svg class="trend-chart-svg" viewBox="0 0 ${svgWidth} ${svgHeight}" preserveAspectRatio="none">
                    <defs>
                        <linearGradient id="trendGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stop-color="#25d366" stop-opacity="0.4"/>
                            <stop offset="100%" stop-color="#25d366" stop-opacity="0"/>
                        </linearGradient>
                    </defs>
                    <path class="trend-area" d="${areaPath}"/>
                    <path class="trend-line" d="${linePath}"/>
        `;

        // Dots with tooltips
        points.forEach(p => {
            html += `<circle class="trend-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3">
                <title>${p.label}: ${p.value.toLocaleString()} messages</title>
            </circle>`;
        });

        html += `</svg></div>`;

        // X-axis labels (show subset to avoid crowding)
        const maxLabels = 12;
        const step = Math.max(1, Math.floor(labels.length / maxLabels));
        html += '<div class="trend-labels">';
        for (let i = 0; i < labels.length; i += step) {
            html += `<span>${labels[i]}</span>`;
        }
        if ((labels.length - 1) % step !== 0) {
            html += `<span>${labels[labels.length - 1]}</span>`;
        }
        html += '</div>';

        return html;
    }

    // ========================
    // Navigation
    // ========================
    newUploadBtn.addEventListener('click', () => {
        chatData = null;
        selectedParticipant = null;
        userSender = null;
        participantColorMap.clear();
        colorIndex = 0;
        messagesContainer.innerHTML = '';
        searchInput.value = '';
        fileInput.value = '';

        // Clean up blob URLs
        for (const url of mediaMap.values()) {
            URL.revokeObjectURL(url);
        }
        mediaMap.clear();

        chatScreen.classList.remove('active');
        uploadScreen.classList.add('active');
    });

    sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
    });

    chatBody.addEventListener('scroll', () => {
        const fromBottom = chatBody.scrollHeight - chatBody.scrollTop - chatBody.clientHeight;
        scrollBottomBtn.style.display = fromBottom > 300 ? 'flex' : 'none';
    });

    scrollBottomBtn.addEventListener('click', () => {
        chatBody.scrollTop = chatBody.scrollHeight;
    });

    // ========================
    // Utilities
    // ========================
    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function linkify(text) {
        const urlRegex = /(https?:\/\/[^\s<]+)/gi;
        return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    }

    function highlightSearch(html, search) {
        if (!search) return html;
        const regex = new RegExp(`(${escapeRegex(search)})`, 'gi');
        return html.replace(regex, '<span class="search-highlight">$1</span>');
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

})();
