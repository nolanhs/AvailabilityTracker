const firebaseConfig = {
  databaseURL: "https://eagle-vision-occupancy-fb318-default-rtdb.firebaseio.com/"
};

let hasFirebaseSnapshot = false;
let hourlyAnalyticsCache = {};
let backendCurrentSnapshot = [];
let backendBaseUrl = null;
const backendTimeseriesCache = new Map();
const BACKEND_BASE_CANDIDATES = [...new Set([
    window.location.protocol.startsWith('http') ? window.location.origin : null,
    'http://35.243.237.220:8080'
].filter(Boolean))];

function buildBackendUrl(base, path) {
    return `${base.replace(/\/$/, '')}${path}`;
}

async function fetchBackendJson(path) {
    const candidates = backendBaseUrl
        ? [backendBaseUrl, ...BACKEND_BASE_CANDIDATES.filter(base => base !== backendBaseUrl)]
        : BACKEND_BASE_CANDIDATES;

    let lastError = null;
    for (const base of candidates) {
        const url = buildBackendUrl(base, path);
        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            backendBaseUrl = base;
            return await response.json();
        } catch (error) {
            lastError = error;
            console.warn(`[Backend] Request failed for ${url}:`, error);
        }
    }

    throw lastError || new Error(`Unable to load ${path}`);
}

function normalizeBackendRoomStatus(status) {
    return {
        roomKey: status.roomCode,
        roomCode: status.roomCode,
        fullName: status.roomCode,
        roomName: status.roomName,
        buildingCode: status.buildingCode,
        deviceCount: Number(status.deviceCount) || 0,
        isOccupied: Boolean(status.isOccupied)
    };
}

async function loadBackendCurrentOccupancy(options = {}) {
    const data = await fetchBackendJson('/api/occupancy/current');
    backendCurrentSnapshot = Array.isArray(data) ? data : [];

    if (options.applyToCards !== false) {
        updateRoomCards(backendCurrentSnapshot.map(normalizeBackendRoomStatus));
    }

    return backendCurrentSnapshot;
}

async function loadBackendTimeseries(roomCode, hours = 168) {
    const cacheKey = `${roomCode}:${hours}`;
    if (backendTimeseriesCache.has(cacheKey)) {
        return backendTimeseriesCache.get(cacheKey);
    }

    const data = await fetchBackendJson(`/api/occupancy/timeseries/${encodeURIComponent(roomCode)}?hours=${hours}`);
    const normalized = Array.isArray(data) ? data : [];
    backendTimeseriesCache.set(cacheKey, normalized);
    return normalized;
}

function aggregateHourlySamples(samples) {
    const buckets = {};

    samples.forEach(sample => {
        const timestamp = String(sample?.timestamp || '');
        const hour = Number(timestamp.slice(11, 13));
        if (Number.isNaN(hour)) return;

        if (!buckets[hour]) {
            buckets[hour] = { total: 0, count: 0 };
        }

        buckets[hour].total += Number(sample?.deviceCount) || 0;
        buckets[hour].count += 1;
    });

    const hourlyMap = {};
    for (let hour = 6; hour <= 22; hour++) {
        const bucket = buckets[hour];
        hourlyMap[hour] = bucket ? bucket.total / bucket.count : 0;
    }

    return hourlyMap;
}

async function getBackendHourlySeries(buildingCode) {
    const currentRooms = backendCurrentSnapshot.length > 0
        ? backendCurrentSnapshot
        : await loadBackendCurrentOccupancy({ applyToCards: false });

    const relevantRooms = currentRooms.filter(room => buildingCode === 'all' || room.buildingCode === buildingCode);
    const samples = [];

    for (const room of relevantRooms) {
        const roomHistory = await loadBackendTimeseries(room.roomCode, 168);
        samples.push(...roomHistory);
    }

    return aggregateHourlySamples(samples);
}

const roomSearch = document.getElementById("roomSearch");
        const campusSelect = document.getElementById("campus");
        const resultsCount = document.getElementById("resultsCount");

        // Dark mode management
        function initDarkMode() {
            const savedTheme = localStorage.getItem('theme');
            if (savedTheme === 'dark') {
                document.documentElement.setAttribute('data-theme', 'dark');
                document.getElementById('darkModeIcon').className = 'bi bi-sun-fill';
            }
        }

        function toggleDarkMode() {
            const html = document.documentElement;
            const icon = document.getElementById('darkModeIcon');

            if (html.getAttribute('data-theme') === 'dark') {
                html.removeAttribute('data-theme');
                icon.className = 'bi bi-moon-fill';
                localStorage.setItem('theme', 'light');
            } else {
                html.setAttribute('data-theme', 'dark');
                icon.className = 'bi bi-sun-fill';
                localStorage.setItem('theme', 'dark');
            }
        }

        // Initialize dark mode on page load
        initDarkMode();

        // Favorites management (stored in localStorage)
        function getFavorites() {
            const favs = localStorage.getItem('roomFavorites');
            return favs ? JSON.parse(favs) : [];
        }

        function saveFavorites(favorites) {
            localStorage.setItem('roomFavorites', JSON.stringify(favorites));
        }

        function toggleFavorite(btn) {
            const card = btn.closest('.room-card');
            const roomName = card.dataset.room;
            let favorites = getFavorites();

            if (favorites.includes(roomName)) {
                // Remove from favorites
                favorites = favorites.filter(f => f !== roomName);
                btn.classList.remove('favorited');
                btn.querySelector('i').className = 'bi bi-pin-angle';
                card.classList.remove('is-favorite');
            } else {
                // Pin to top
                favorites.push(roomName);
                btn.classList.add('favorited');
                btn.querySelector('i').className = 'bi bi-pin-angle-fill';
                card.classList.add('is-favorite');
            }

            saveFavorites(favorites);
            reorderPinnedRooms();
            applyFilters();
        }

        function initFavorites() {
            const favorites = getFavorites();
            document.querySelectorAll('.room-card').forEach(card => {
                const roomName = card.dataset.room;
                const btn = card.querySelector('.fav-btn');
                if (btn && favorites.includes(roomName)) {
                    btn.classList.add('favorited');
                    btn.querySelector('i').className = 'bi bi-pin-angle-fill';
                    card.classList.add('is-favorite');
                }
            });
            reorderPinnedRooms();
        }

        function reorderPinnedRooms() {
            const container = document.querySelector('#roomsTab > div > div');
            if (!container) return;

            const favorites = getFavorites();
            const cards = Array.from(container.querySelectorAll('.room-card'));

            // Sort: pinned first, then alphabetically
            cards.sort((a, b) => {
                const aFav = favorites.includes(a.dataset.room);
                const bFav = favorites.includes(b.dataset.room);
                if (aFav && !bFav) return -1;
                if (!aFav && bFav) return 1;
                return (a.dataset.room || '').localeCompare(b.dataset.room || '');
            });

            // Reorder in DOM
            cards.forEach(card => container.appendChild(card));
        }

        // Occupancy levels based on device count
        // 0: Vacant, 1: Low, 2-3: Medium, 4+: High
        function getOccupancyLevel(deviceCount) {
            if (deviceCount === 0) return 'vacant';
            if (deviceCount === 1) return 'low';
            if (deviceCount <= 3) return 'medium';
            return 'high';
        }

        function getOccupancyLabel(level) {
            switch (level) {
                case 'vacant': return 'VACANT';
                case 'low': return 'LOW';
                case 'medium': return 'MEDIUM';
                case 'high': return 'HIGH';
                default: return 'VACANT';
            }
        }

                function getOccupancyStyle(level) {
            switch (level) {
                case 'vacant':
                    return { color: '#117a3a', borderColor: 'rgba(17,122,58,0.25)', background: 'rgba(17,122,58,0.10)' };
                case 'low':
                    return { color: '#0891b2', borderColor: 'rgba(8,145,178,0.25)', background: 'rgba(8,145,178,0.10)' };
                case 'medium':
                    return { color: '#d97706', borderColor: 'rgba(217,119,6,0.25)', background: 'rgba(217,119,6,0.10)' };
                case 'high':
                    return { color: '#b42318', borderColor: 'rgba(180,35,24,0.25)', background: 'rgba(180,35,24,0.10)' };
                default:
                    return { color: '#117a3a', borderColor: 'rgba(17,122,58,0.25)', background: 'rgba(17,122,58,0.10)' };
            }
        }

        function normalizeRoomKey(value) {
            if (value === null || value === undefined) return '';
            return String(value).trim().replace(/\s+/g, '_').replace(/-/g, '_').toUpperCase();
        }

        function buildRoomCandidates(roomKeyOrName, roomData = {}) {
            const rawCandidates = [
                roomKeyOrName,
                roomData.roomKey,
                roomData.roomCode,
                roomData.fullName,
                roomData.roomName,
                roomData.name,
                roomData.roomID && roomData.buildingCode ? `${roomData.buildingCode}_${roomData.roomID}` : '',
                roomData.roomName && roomData.buildingCode ? `${roomData.buildingCode}_${roomData.roomName}` : '',
                roomData.roomName && roomData.buildingCode ? `${roomData.buildingCode} ${roomData.roomName}` : ''
            ];

            return [...new Set(rawCandidates.map(normalizeRoomKey).filter(Boolean))];
        }

        function findRoomCard(roomKeyOrName, roomData = {}) {
            const candidates = buildRoomCandidates(roomKeyOrName, roomData);
            if (candidates.length === 0) return null;

            return Array.from(document.querySelectorAll('.room-card')).find(card => {
                const cardKey = normalizeRoomKey(card.dataset.room);
                return candidates.includes(cardKey);
            }) || null;
        }

        function ensureStatusBadge(card) {
            let badge = card.querySelector('.ev-badge');
            if (badge) return badge;

            const topRow = card.querySelector('div');
            if (!topRow) return null;

            badge = document.createElement('span');
            badge.className = 'ev-badge';
            topRow.appendChild(badge);
            return badge;
        }

        function setCardOccupancy(card, deviceCount) {
            const safeCount = Math.max(0, Number(deviceCount) || 0);
            const level = getOccupancyLevel(safeCount);
            const label = getOccupancyLabel(level);
            const style = getOccupancyStyle(level);
            const badge = ensureStatusBadge(card);

            card.dataset.occupancy = level;
            card.dataset.deviceCount = String(safeCount);
            card.style.borderLeft = `8px solid ${style.color}`;

            if (!badge) return;

            badge.textContent = label;
            badge.style.color = style.color;
            badge.style.borderColor = style.borderColor;
            badge.style.background = style.background;
        }

        function updateSummaryCounts() {
            let vacant = 0;
            let low = 0;
            let medium = 0;
            let high = 0;

            document.querySelectorAll('.room-card').forEach(card => {
                switch (card.dataset.occupancy || 'vacant') {
                    case 'low':
                        low++;
                        break;
                    case 'medium':
                        medium++;
                        break;
                    case 'high':
                        high++;
                        break;
                    default:
                        vacant++;
                        break;
                }
            });

            const v = document.getElementById('vacantCount');
            const l = document.getElementById('lowCount');
            const m = document.getElementById('mediumCount');
            const h = document.getElementById('highCount');

            if (v) v.textContent = String(vacant);
            if (l) l.textContent = String(low);
            if (m) m.textContent = String(medium);
            if (h) h.textContent = String(high);
        }

        function refreshLiveUi() {
            updateSummaryCounts();
            applyFilters();

            const trendsTab = document.getElementById('trendsTab');
            if (trendsTab && trendsTab.style.display !== 'none') {
                updateTrendsData();
            }
        }

        function syncRoomsFromFirebase(rooms) {
            const seenCards = new Set();

            Object.entries(rooms || {}).forEach(([roomKey, roomData]) => {
                const card = findRoomCard(roomKey, roomData || {});
                if (!card) {
                    console.warn('[Firebase] No matching room card for:', roomKey, roomData);
                    return;
                }

                const deviceCount = roomData?.deviceCount ?? roomData?.devices ?? (roomData?.isOccupied ? 1 : 0);
                setCardOccupancy(card, deviceCount);
                seenCards.add(card);
            });

            document.querySelectorAll('.room-card').forEach(card => {
                if (!seenCards.has(card)) {
                    setCardOccupancy(card, 0);
                }
            });

            refreshLiveUi();
        }

                async function initFirebaseSync() {
            try {
                const [{ initializeApp }, { getDatabase, ref, onValue }] = await Promise.all([
                    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
                    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js')
                ]);

                const firebaseApp = initializeApp(firebaseConfig);
                const firebaseDb = getDatabase(firebaseApp);
                const roomsRef = ref(firebaseDb, 'rooms');
                const hourlyAnalyticsRef = ref(firebaseDb, 'analytics/hourlyByBuilding');

                console.log('[Firebase] Realtime sync initialized.');

                onValue(roomsRef, (snapshot) => {
                    hasFirebaseSnapshot = true;
                    const rooms = snapshot.val();

                    if (!rooms) {
                        console.warn('[Firebase] /rooms snapshot is empty; marking all rooms vacant.');
                        syncRoomsFromFirebase({});
                        return;
                    }

                    syncRoomsFromFirebase(rooms);
                }, (error) => {
                    console.error('[Firebase] Realtime room listener error:', error);
                });

                onValue(hourlyAnalyticsRef, (snapshot) => {
                    hourlyAnalyticsCache = snapshot.val() || {};
                    const trendsTab = document.getElementById('trendsTab');
                    if (trendsTab && trendsTab.style.display !== 'none') {
                        populatePeakHoursBuildingDropdown();
                        updatePeakHoursChart(document.getElementById('peakHoursBuildingSelect').value || 'all');
                    }
                }, (error) => {
                    console.error('[Firebase] Hourly analytics listener error:', error);
                });
            } catch (error) {
                console.error('[Firebase] Failed to initialize realtime sync:', error);
            }
        }

        // Add badges on page load based on data-occupancy attribute
        function addStatusBadges() {
            document.querySelectorAll('.room-card').forEach(card => {
                const level = card.dataset.occupancy || 'vacant';
                const label = getOccupancyLabel(level);
                const style = getOccupancyStyle(level);
                const badge = ensureStatusBadge(card);

                if (!badge) return;

                badge.textContent = label;
                badge.style.color = style.color;
                badge.style.borderColor = style.borderColor;
                badge.style.background = style.background;

                if (!card.dataset.deviceCount) {
                    card.dataset.deviceCount = level === 'high' ? '4' : level === 'medium' ? '2' : level === 'low' ? '1' : '0';
                }
            });
        }

        function updateCardStatus(roomKeyOrName, deviceCount, roomData = {}, options = {}) {
            const card = findRoomCard(roomKeyOrName, roomData);
            if (!card) {
                console.log('[Frontend] No card found for:', roomKeyOrName, roomData);
                return false;
            }

            setCardOccupancy(card, deviceCount);

            if (options.refresh !== false) {
                refreshLiveUi();
            }

            return true;
        }

        function updateRoomCards(roomStatusList) {
            if (!Array.isArray(roomStatusList)) {
                console.warn('[updateRoomCards] Expected an array of room statuses but received:', roomStatusList);
                return;
            }

            console.log('[updateRoomCards] Updating rooms with:', roomStatusList);
            let updateCount = 0;

            roomStatusList.forEach(status => {
                const roomIdentifier = status.roomKey
                    || status.roomCode
                    || status.fullName
                    || (status.buildingCode && status.roomName ? `${status.buildingCode}_${status.roomName}` : status.roomName);
                const deviceCount = status.deviceCount !== undefined
                    ? status.deviceCount
                    : (status.isOccupied === 1 || status.isOccupied === true ? 1 : 0);

                if (updateCardStatus(roomIdentifier, deviceCount, status, { refresh: false })) {
                    updateCount++;
                }
            });

            console.log('[updateRoomCards] Total cards updated:', updateCount, 'out of', roomStatusList.length);
            refreshLiveUi();
        }

        function applyFilters() {
            const query = roomSearch.value.toLowerCase().trim();
            const selectedCampus = campusSelect.value;
            const selectedOccupancy = document.getElementById('occupancyFilter').value;
            const favorites = getFavorites();
            let visibleCount = 0;
            document.querySelectorAll(".room-card").forEach(card => {
                const roomName = (card.dataset.room || "").toLowerCase();
                const roomNameFull = card.dataset.room || "";
                const building = card.dataset.building;
                const occupancy = card.dataset.occupancy || 'vacant';
                const isFavorite = favorites.includes(roomNameFull);
                const matchesSearch = roomName.includes(query);
                const matchesCampus = selectedCampus === "" || building === selectedCampus;
                const matchesOccupancy = selectedOccupancy === "" ||
                    (selectedOccupancy === "favorites" ? isFavorite : occupancy === selectedOccupancy);
                const show = (matchesSearch && matchesCampus && matchesOccupancy);
                card.style.display = show ? "" : "none";
                if (show) visibleCount++;
            });
            resultsCount.innerHTML = `<i class="bi bi-grid-3x3-gap"></i> Results: ${visibleCount}`;
        }

        // Add badges on page load
        addStatusBadges();
        initFavorites();
        refreshLiveUi();
        initFirebaseSync();

                // Initial load from backend API so counts and trends work even before Firebase finishes syncing.
        console.log('[Frontend] Loading initial room status from backend API...');
        loadBackendCurrentOccupancy()
            .then(roomStatusList => {
                console.log('[Frontend] Initial backend room status loaded:', roomStatusList);
                if (!roomStatusList || roomStatusList.length === 0) {
                    console.warn('[Frontend] No rooms returned from backend initial load.');
                }
            })
            .catch(err => console.error('[Frontend] Error loading room status from backend:', err));

            // âœ… Hook up filters FIRST so search/dropdowns always work
            roomSearch.addEventListener("input", applyFilters);
            campusSelect.addEventListener("change", applyFilters);
            document.getElementById('occupancyFilter').addEventListener("change", applyFilters);

            // âœ… Live updates via socket.io (guarded so it can't break the page)
            let socket = null;

            if (window.io) {
              console.log('[Frontend] Initializing Socket.io connection...');
              socket = io();

              socket.on('connect', () => {
                console.log('[Socket.io] âœ“ Connected to server! Socket ID:', socket.id);
              });

              socket.on('connect_error', (error) => {
                console.error('[Socket.io] âœ— Connection error:', error);
              });

              socket.on('disconnect', (reason) => {
                console.log('[Socket.io] Disconnected. Reason:', reason);
              });

              socket.on('sensor-update', (data) => {
                console.log('[Frontend] Received sensor-update:', data);

                // data contains: { fullName: "AIEB 216", deviceCount: number, roomName: "AIEB", roomID: 216 }
                if (data.fullName) {
                  const deviceCount = data.deviceCount !== undefined ? data.deviceCount : 0;
                  updateCardStatus(data.fullName, deviceCount, data);
                } else {
                  console.log('[Frontend] No fullName in sensor-update data');
                }
              });

            } else {
              console.warn('[Socket.io] socket.io client not loaded -> live updates disabled (filters still work).');
            }
            
        // Tab Switching
        function showTab(tabName) {
            const roomsTab = document.getElementById('roomsTab');
            const trendsTab = document.getElementById('trendsTab');
            const roomsBtn = document.getElementById('roomsTabBtn');
            const trendsBtn = document.getElementById('trendsTabBtn');

            if (tabName === 'rooms') {
                roomsTab.style.display = 'block';
                trendsTab.style.display = 'none';
                roomsBtn.classList.add('active');
                trendsBtn.classList.remove('active');
            } else {
                roomsTab.style.display = 'none';
                trendsTab.style.display = 'block';
                roomsBtn.classList.remove('active');
                trendsBtn.classList.add('active');
                updateTrendsData();
            }
        }

        // Make showTab available globally
        window.showTab = showTab;

                // Chart instances
        const BUILDING_LABELS = {
            AIEB: 'AIEB',
            LIBR: 'Library',
            LSC: 'LSC'
        };

        let buildingChart = null;
        let statusChart = null;
        let peakHoursChart = null;

        function getRoomCards() {
            return Array.from(document.querySelectorAll('.room-card'));
        }

        function getCardRoomKey(card) {
            return normalizeRoomKey(card.dataset.room);
        }

        function getCardDisplayName(card) {
            const label = card.querySelector('strong')?.textContent?.trim();
            return label || (card.dataset.room || '').replace(/_/g, ' ');
        }

        function getCardBuildingCode(card) {
            const keyPrefix = getCardRoomKey(card).split('_')[0];
            if (keyPrefix) return keyPrefix;

            const fallback = normalizeRoomKey(card.dataset.building);
            return fallback === 'LIBRARY' ? 'LIBR' : fallback;
        }

        function getBuildingLabel(buildingCode) {
            return BUILDING_LABELS[buildingCode] || buildingCode;
        }

                function getAvailableBuildingCodes() {
            const fromCards = getRoomCards().map(getCardBuildingCode).filter(Boolean);
            const fromAnalytics = Object.keys(hourlyAnalyticsCache || {}).filter(code => code && code !== 'all');
            const fromBackend = backendCurrentSnapshot.map(room => room.buildingCode).filter(Boolean);
            return [...new Set([...fromCards, ...fromAnalytics, ...fromBackend])].sort();
        }

        function ensurePeakHoursSummary() {
            let summary = document.getElementById('peakHoursSummary');
            if (summary) return summary;

            const chartCard = document.getElementById('peakHoursChart')?.closest('.ev-card');
            if (!chartCard) return null;

            summary = document.createElement('div');
            summary.id = 'peakHoursSummary';
            summary.style.marginBottom = '12px';
            summary.style.color = 'var(--text-muted)';
            summary.style.fontWeight = '600';
            summary.style.fontSize = '0.95rem';

            const chartWrap = document.getElementById('peakHoursChart')?.parentElement;
            if (chartWrap) {
                chartCard.insertBefore(summary, chartWrap);
            }

            return summary;
        }

        function formatHourLabel(hour) {
            if (hour === 0) return '12AM';
            if (hour < 12) return `${hour}AM`;
            if (hour === 12) return '12PM';
            return `${hour - 12}PM`;
        }

        function parseHourlySeries(source) {
            const hourlyMap = {};

            if (Array.isArray(source)) {
                source.forEach((entry, index) => {
                    const isObjectEntry = entry !== null && typeof entry === 'object';
                    const hour = isObjectEntry
                        ? Number(entry?.hour ?? entry?.label ?? entry?.slot ?? index)
                        : index;
                    const value = isObjectEntry
                        ? Number(entry?.avg_devices ?? entry?.avgDevices ?? entry?.deviceCount ?? entry?.value ?? entry?.count ?? 0)
                        : Number(entry ?? 0);
                    if (!Number.isNaN(hour)) {
                        hourlyMap[hour] = value;
                    }
                });
                return hourlyMap;
            }

            if (source && typeof source === 'object') {
                Object.entries(source).forEach(([key, value]) => {
                    if (value && typeof value === 'object') {
                        const hour = Number(value.hour ?? key);
                        const amount = Number(value.avg_devices ?? value.avgDevices ?? value.deviceCount ?? value.value ?? value.count ?? 0);
                        if (!Number.isNaN(hour)) {
                            hourlyMap[hour] = amount;
                        }
                        return;
                    }

                    const hour = Number(key);
                    const amount = Number(value ?? 0);
                    if (!Number.isNaN(hour)) {
                        hourlyMap[hour] = amount;
                    }
                });
            }

            return hourlyMap;
        }

                async function getHourlySeriesForBuilding(buildingCode) {
            if (buildingCode === 'all') {
                const directAll = parseHourlySeries(hourlyAnalyticsCache?.all);
                if (Object.keys(directAll).length > 0) {
                    return directAll;
                }

                const aggregate = {};
                getAvailableBuildingCodes().forEach(code => {
                    const series = parseHourlySeries(hourlyAnalyticsCache?.[code]);
                    for (let hour = 6; hour <= 22; hour++) {
                        aggregate[hour] = (aggregate[hour] || 0) + (Number(series[hour]) || 0);
                    }
                });

                if (Object.values(aggregate).some(value => value > 0)) {
                    return aggregate;
                }
            } else {
                const firebaseSeries = parseHourlySeries(hourlyAnalyticsCache?.[buildingCode]);
                if (Object.keys(firebaseSeries).length > 0) {
                    return firebaseSeries;
                }
            }

            return getBackendHourlySeries(buildingCode);
        }

        function updatePeakHoursSummary(hourlyMap, buildingCode) {
            const summary = ensurePeakHoursSummary();
            if (!summary) return;

            const entries = [];
            for (let hour = 6; hour <= 22; hour++) {
                entries.push({ hour, value: Number(hourlyMap[hour]) || 0 });
            }

            const hasData = entries.some(entry => entry.value > 0);
            if (!hasData) {
                const label = buildingCode === 'all' ? 'all buildings' : getBuildingLabel(buildingCode);
                summary.textContent = `No historical data yet for ${label}. Firebase analytics is empty and the backend has no samples in this window.`;
                return;
            }

            const busiest = entries.reduce((best, current) => current.value > best.value ? current : best, entries[0]);
            const quietest = entries.reduce((best, current) => current.value < best.value ? current : best, entries[0]);
            summary.textContent = `Busiest hour: ${formatHourLabel(busiest.hour)} (${busiest.value.toFixed(1)} avg devices) | Least busy hour: ${formatHourLabel(quietest.hour)} (${quietest.value.toFixed(1)} avg devices)`;
        }

        function populateBuildingDropdown() {
            const select = document.getElementById('buildingChartSelect');
            const selected = select.value || 'all';
            const options = ['<option value="all">All Buildings</option>'];

            getAvailableBuildingCodes().forEach(code => {
                options.push(`<option value="${code}">${code} - ${getBuildingLabel(code)}</option>`);
            });

            select.innerHTML = options.join('');
            select.value = options.some(option => option.includes(`value="${selected}"`)) ? selected : 'all';
        }

        function populatePeakHoursBuildingDropdown() {
            const select = document.getElementById('peakHoursBuildingSelect');
            const selected = select.value || 'all';
            const options = ['<option value="all">All Buildings</option>'];

            getAvailableBuildingCodes().forEach(code => {
                options.push(`<option value="${code}">${code} - ${getBuildingLabel(code)}</option>`);
            });

            select.innerHTML = options.join('');
            select.value = options.some(option => option.includes(`value="${selected}"`)) ? selected : 'all';
        }

        function getBuildingStatsFromCards() {
            const stats = {};

            getRoomCards().forEach(card => {
                const code = getCardBuildingCode(card);
                if (!code) return;

                if (!stats[code]) {
                    stats[code] = { occupied: 0, vacant: 0, rooms: [] };
                }

                const level = card.dataset.occupancy || 'vacant';
                const occupied = level !== 'vacant';
                if (occupied) {
                    stats[code].occupied += 1;
                } else {
                    stats[code].vacant += 1;
                }

                stats[code].rooms.push({
                    name: getCardDisplayName(card),
                    occupied,
                    level,
                    deviceCount: Number(card.dataset.deviceCount) || 0
                });
            });

            return stats;
        }

        async function updateTrendsData() {
            const cards = getRoomCards();
            let vacant = 0;
            let low = 0;
            let medium = 0;
            let high = 0;
            let totalDevices = 0;

            cards.forEach(card => {
                const level = card.dataset.occupancy || 'vacant';
                const deviceCount = parseInt(card.dataset.deviceCount, 10) || 0;
                totalDevices += deviceCount;

                switch (level) {
                    case 'low':
                        low++;
                        break;
                    case 'medium':
                        medium++;
                        break;
                    case 'high':
                        high++;
                        break;
                    default:
                        vacant++;
                        break;
                }
            });

            document.getElementById('statVacantRooms').textContent = String(vacant);
            document.getElementById('statOccupiedRooms').textContent = String(cards.length - vacant);
            document.getElementById('statAvgOccupancy').textContent = cards.length > 0 ? (totalDevices / cards.length).toFixed(1) : '0';

            populateBuildingDropdown();
            await updateBuildingChart(document.getElementById('buildingChartSelect').value || 'all');

            if (statusChart) statusChart.destroy();
            const statusCtx = document.getElementById('statusChart').getContext('2d');
            statusChart = new Chart(statusCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Vacant (0)', 'Low (1)', 'Medium (2-3)', 'High (4+)'],
                    datasets: [{
                        data: [vacant, low, medium, high],
                        backgroundColor: ['#117a3a', '#0891b2', '#d97706', '#b42318'],
                        borderWidth: 0
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { position: 'right' } }
                }
            });

            populatePeakHoursBuildingDropdown();
            await updatePeakHoursChart(document.getElementById('peakHoursBuildingSelect').value || 'all');
        }

        async function updateBuildingChart(buildingCode) {
            const buildingStats = getBuildingStatsFromCards();
            const buildingCtx = document.getElementById('buildingChart').getContext('2d');
            if (buildingChart) buildingChart.destroy();

            if (buildingCode === 'all') {
                const codes = Object.keys(buildingStats).sort();
                const occupied = codes.map(code => buildingStats[code].occupied);
                const vacant = codes.map(code => buildingStats[code].vacant);

                buildingChart = new Chart(buildingCtx, {
                    type: 'bar',
                    data: {
                        labels: codes.map(code => `${code}`),
                        datasets: [
                            { label: 'Occupied', data: occupied, backgroundColor: '#b42318', borderRadius: 8 },
                            { label: 'Vacant', data: vacant, backgroundColor: '#117a3a', borderRadius: 8 }
                        ]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'top' } },
                        scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
                    }
                });
                return;
            }

            const rooms = buildingStats[buildingCode]?.rooms || [];
            const labels = rooms.map(room => room.name);
            const barValues = rooms.map(() => 1);
            const barColors = rooms.map(room => room.occupied ? '#b42318' : '#117a3a');
            const statusLabels = rooms.map(room => room.occupied ? `Occupied (${room.deviceCount} devices)` : 'Vacant');

            buildingChart = new Chart(buildingCtx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Room Status',
                        data: barValues,
                        backgroundColor: barColors,
                        borderRadius: 8
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label(context) {
                                    return statusLabels[context.dataIndex];
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            display: false,
                            beginAtZero: true,
                            max: 1
                        }
                    }
                }
            });
        }

        async function updatePeakHoursChart(buildingCode) {
            const hourlyMap = await getHourlySeriesForBuilding(buildingCode);
            const hourLabels = [];
            const hourData = [];

            for (let hour = 6; hour <= 22; hour++) {
                hourLabels.push(formatHourLabel(hour));
                hourData.push(Number(hourlyMap[hour]) || 0);
            }

            updatePeakHoursSummary(hourlyMap, buildingCode);

            if (peakHoursChart) peakHoursChart.destroy();
            const peakCtx = document.getElementById('peakHoursChart').getContext('2d');
            peakHoursChart = new Chart(peakCtx, {
                type: 'line',
                data: {
                    labels: hourLabels,
                    datasets: [{
                        label: buildingCode === 'all' ? 'Avg Devices Across Buildings' : `Avg Devices in ${getBuildingLabel(buildingCode)}`,
                        data: hourData,
                        borderColor: '#0891b2',
                        backgroundColor: 'rgba(8, 145, 178, 0.1)',
                        fill: true,
                        tension: 0.4
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: { y: { beginAtZero: true } }
                }
            });
        }

        document.getElementById('buildingChartSelect').addEventListener('change', (e) => {
            updateBuildingChart(e.target.value);
        });

        document.getElementById('peakHoursBuildingSelect').addEventListener('change', (e) => {
            updatePeakHoursChart(e.target.value);
        });


window.toggleDarkMode = toggleDarkMode;
window.toggleFavorite = toggleFavorite;
window.showTab = showTab;







