// Add automatic refresh functionality to app.js
// This will poll the API every 30 seconds to update appointments

// Add this after the existing code in app.js

let autoRefreshInterval = null;
const AUTO_REFRESH_INTERVAL = 30000; // 30 seconds

function startAutoRefresh() {
    // Clear any existing interval
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // Start auto-refresh
    autoRefreshInterval = setInterval(() => {
        console.log('Auto-refreshing appointments...');
        loadDay();
    }, AUTO_REFRESH_INTERVAL);
    
    console.log('Auto-refresh started (every 30 seconds)');
}

function stopAutoRefresh() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
        console.log('Auto-refresh stopped');
    }
}

// Start auto-refresh when page loads
document.addEventListener('DOMContentLoaded', () => {
    // ... existing code ...
    startAutoRefresh();
});

// Stop auto-refresh when page is hidden (to save resources)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        startAutoRefresh();
    }
});

