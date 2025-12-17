<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="theme-color" content="#0b3a53" />
  <title>Fairway Forecast</title>

  <link rel="icon" href="favicon.svg" type="image/svg+xml" />
  <link rel="stylesheet" href="styles.css" />
</head>

<body>
  <a class="skip-link" href="#main">Skip to forecast</a>

  <header class="ff-header">
    <div class="ff-brand">
      <img class="ff-logo" src="logo.svg" alt="Fairway Forecast" />
      <div class="ff-brand-text">
        <div class="ff-title">Fairway Forecast</div>
        <div class="ff-tagline">Golf-first weather</div>
      </div>
    </div>
  </header>

  <main id="main" class="ff-main">
    <section class="ff-panel ff-card">
      <div class="ff-controls">
        <label class="ff-label" for="unitsSelect">Units</label>
        <select id="unitsSelect" class="ff-select" aria-label="Units">
          <option value="metric" selected>°C</option>
          <option value="imperial">°F</option>
        </select>

        <button id="btnGeo" class="ff-icon-btn" type="button" title="Courses near me" aria-label="Courses near me">
          ⌖
        </button>
      </div>

      <label class="ff-label" for="searchInput">Search location or golf course</label>
      <div class="ff-search">
        <input
          id="searchInput"
          class="ff-input"
          type="text"
          inputmode="search"
          autocomplete="off"
          placeholder="e.g. Swindon, GB or Royal Troon"
        />
        <button id="searchBtn" class="ff-btn" type="button">Search</button>
      </div>

      <p class="ff-hint">
        Tip: type a town/city for places, or include “golf / club / gc” for course-first results.
      </p>
    </section>

    <section class="ff-tabs">
      <button id="tabCurrent" class="ff-tab active" type="button">Current</button>
      <button id="tabHourly" class="ff-tab" type="button">Hourly</button>
      <button id="tabDaily" class="ff-tab" type="button">Daily</button>
    </section>

    <!-- This is where app.js renders course results + weather cards -->
    <section id="results" class="ff-results" aria-live="polite"></section>

    <section class="ff-side ff-card">
      <h2 class="ff-h2">Playability</h2>
      <div class="ff-playability">
        <div id="playabilityScore" class="ff-play-score">--/10</div>
        <button class="ff-link-btn" type="button" onclick="document.getElementById('playHelp').showModal();">
          What affects playability?
        </button>
      </div>
    </section>

    <dialog id="playHelp" class="ff-dialog">
      <div class="ff-dialog-inner">
        <h3 class="ff-h3">What affects playability?</h3>
        <ul class="ff-list">
          <li><b>Wind</b>: stronger gusts reduce control and comfort.</li>
          <li><b>Rain probability</b>: higher chance = higher disruption.</li>
          <li><b>Temperature comfort</b>: very cold/very hot reduces enjoyment.</li>
        </ul>
        <button class="ff-btn" type="button" onclick="document.getElementById('playHelp').close();">Close</button>
      </div>
    </dialog>
  </main>

  <footer class="ff-footer">
    <span>Weather data © OpenWeather</span>
    <span>•</span>
    <span>Course data © GolfCourseAPI</span>
  </footer>

  <script src="config.js"></script>
  <script src="app.js"></script>
</body>
</html>
