// =================================================================
// 1. SUPABASE SETUP AND CONSTANTS
// =================================================================
const SUPABASE_URL = 'https://nylxshmbljthjizgijou.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im55bHhzaG1ibGp0aGppemdpanbvdSIsImV4cCI6MTcxOTc2MzA3M30.7Q_B46m55H2Vw23R3T4_dO8T9w7w3B89yqY2H5t89zQ'; 

let supabase; 

// =================================================================
// 2. ELEMENT REFERENCES
// =================================================================

const courseSearchInput = document.getElementById('course-search');
const searchResultsDiv = document.getElementById('search-results');

// =================================================================
// 3. CORE SEARCH FUNCTIONS
// =================================================================

async function searchCourses(query) {
    if (typeof supabase === 'undefined' || supabase === null) {
         searchResultsDiv.innerHTML = '<p class="no-results error-message">Error: Search service not initialized.</p>';
         return;
    }

    if (query.length < 3) {
        searchResultsDiv.innerHTML = '<p class="no-results">Keep typing to search...</p>';
        return;
    }

    searchResultsDiv.innerHTML = '<p class="no-results">Searching...</p>';

    const { data, error } = await supabase
        .from('golf_courses')
        .select('name, lat, lon, city, state')
        .ilike('name', `%${query}%`) 
        .limit(10); 

    if (error) {
        console.error('Supabase search error:', error);
        searchResultsDiv.innerHTML = `<p class="no-results error-message">Error searching courses: ${error.message}</p>`;
        return;
    }

    displayResults(data);
}

function displayResults(results) {
    if (results.length === 0) {
        searchResultsDiv.innerHTML = '<p class="no-results">No courses found matching your search.</p>';
        return;
    }

    let html = '';
    results.forEach(course => {
        const forecastUrl = `forecast.html?name=${encodeURIComponent(course.name)}&lat=${course.lat}&lon=${course.lon}`;

        html += `
            <div class="result-item" onclick="window.location.href='${forecastUrl}'">
                <strong>${course.name}</strong>
                <small>${course.city}, ${course.state}</small>
            </div>
        `;
    });

    searchResultsDiv.innerHTML = html;
}


// --- Debouncing and Input Handling ---
let debounceTimeout;
const DEBOUNCE_DELAY = 300; 

function handleSearchInput(event) {
    clearTimeout(debounceTimeout);
    const query = event.target.value.trim();
    
    if (query.length >= 3) {
        debounceTimeout = setTimeout(() => {
            searchCourses(query);
        }, DEBOUNCE_DELAY);
    } else {
        searchResultsDiv.innerHTML = '<p class="no-results">Start typing to find a golf course.</p>';
    }
}

// =================================================================
// 4. INITIALIZE
// =================================================================

function setup() {
    // Check for createClient. This will only run after DOM is ready.
    if (typeof createClient === 'function') {
         // SUCCESS: Supabase is found. Initialize it.
         supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
         
         if (courseSearchInput) {
             courseSearchInput.addEventListener('input', handleSearchInput);
         }
         
         searchResultsDiv.innerHTML = '<p class="no-results">Start typing to find a golf course.</p>';

    } else {
         // FAILURE: If it reaches here, the CDN link is still blocked or failed to load.
         searchResultsDiv.innerHTML = '<p class="no-results error-message">Initialization failed: Supabase library did not load.</p>';
    }
}

// CRITICAL FIX: Use DOMContentLoaded instead of window.onload to ensure execution after HTML parsing.
document.addEventListener('DOMContentLoaded', setup);
