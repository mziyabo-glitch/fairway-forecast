// =================================================================
// 1. CONSTANTS
// =================================================================
const OWM_API_KEY = '75e81e064e438b3d07f08396434ebd55'; 
const BASE_WEATHER_URL = 'https://api.openweathermap.org/data/2.5/forecast'; 
const OWM_ICON_URL = 'https://openweathermap.org/img/wn/'; 

// =================================================================
// 2. ELEMENT REFERENCES
// =================================================================

const windAndWeatherDiv = document.getElementById('hourly-wind-weather');
const courseNameDisplay = document.getElementById('course-name-display');

// =================================================================
// 3. UTILITY FUNCTIONS
// =================================================================

function getQueryParams() {
    const params = {};
    const queryString = window.location.search.substring(1);
    const regex = /([^&=]+)=([^&]*)/g;
    let m;
    while (m = regex.exec(queryString)) {
        params[decodeURIComponent(m[1])] = decodeURIComponent(m[2]);
    }
    return params;
}

function degToCompass(num) {
    const val = Math.floor((num / 22.5) + 0.5);
    const arr = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return arr[(val % 16)];
}

// =================================================================
// 4. DISPLAY LOGIC (Renders raw metric data)
// =================================================================

function renderForecast(data) {
    if (!data || !windAndWeatherDiv) return;

    let forecastHTML = '<table>';
    forecastHTML += '<thead><tr><th>Time</th><th>Temp (°C)</th><th>Wind (m/s) / Dir.</th><th>Conditions</th></tr></thead><tbody>';

    if (data.list && data.list.length > 0) {
        
        data.list.forEach(forecast => {
            const dateTime = new Date(forecast.dt * 1000);
            const timeString = dateTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            
            // Data is displayed in raw metric units
            const temp = Math.round(forecast.main.temp); 
            const windSpeed = forecast.wind.speed.toFixed(1); 
            const description = forecast.weather[0].description;
            const windDegree = forecast.wind.deg;
            const windDirection = degToCompass(windDegree); 
            const iconCode = forecast.weather[0].icon;
            const iconUrl = `${OWM_ICON_URL}${iconCode}.png`;

            
            // Data row
            forecastHTML += `
                <tr>
                    <td>${timeString}</td>
                    <td>${temp}</td>
                    <td>${windSpeed} / ${windDirection}</td>
                    <td><img src="${iconUrl}" alt="${description}" style="width: 30px;"> ${description}</td>
                </tr>
            `;
        });

        forecastHTML += '</tbody></table>';

        windAndWeatherDiv.innerHTML = forecastHTML;

    } else {
        windAndWeatherDiv.innerHTML = '<p>No forecast data available for this course.</p>';
    }
}

// =================================================================
// 5. MAIN FETCH FUNCTION
// =================================================================

async function fetchWeatherForCourse() {
    const params = getQueryParams();
    const lat = params.lat;
    const lon = params.lon;
    const name = params.name || 'Golf Course';

    courseNameDisplay.textContent = name;
    
    if (windAndWeatherDiv) { 
        windAndWeatherDiv.innerHTML = '<p>Loading detailed 5-day forecast...</p>'; 
    }
    
    if (!lat || !lon) {
        if (windAndWeatherDiv) { 
             windAndWeatherDiv.innerHTML = '<p class="error-message">Error: Latitude and Longitude not provided in URL.</p>';
        }
        return;
    }

    // Fetch data always using the metric units parameter
    const weatherUrl = `${BASE_WEATHER_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${OWM_API_KEY}`;
    
    try {
        const response = await fetch(weatherUrl);

        if (!response.ok) {
            throw new Error(`Weather API returned status: ${response.status}`);
        }

        const data = await response.json();
        
        renderForecast(data);

    } catch (error) {
        console.error('Failed to fetch weather data:', error);
        windAndWeatherDiv.innerHTML = `<p class="error-message">Failed to load weather. ${error.message}</p>`;
    } 
}


document.addEventListener('DOMContentLoaded', fetchWeatherForCourse);