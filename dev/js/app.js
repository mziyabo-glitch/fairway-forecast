import {
  renderAppShell,
  wireBottomNav,
  setActiveTab,
  wireSheet,
} from "./components/AppShell.js";
import { mountCourseHeader } from "./components/CourseHeader.js";
import { renderForecastView, wireForecastView } from "./views/ForecastView.js";
import {
  renderHomeView,
  wireHomeView,
  renderCoursesView,
  wireCoursesView,
  renderRoundsView,
} from "./views/StubViews.js";
import { CourseService } from "../../shared/course-service.js";
import { fetchWeather, normalizeWeather } from "../../shared/weather-service.js";
import {
  getAvailableDates,
  getValidTeeTimesForDate,
  getRoundDurationHours,
  computeTeeTimeDecision,
  calculateRoundScore,
  calculateDayScore,
  analyzeRainDuringRound,
  getImpactCards,
  findBetterTeeTime,
  findNearestValidTime,
  getDefaultTeeTime,
} from "../../shared/forecast-engine.js";

const APP = window.APP_CONFIG || {};

class FairwayApp {
  constructor() {
    this.apiBase = APP.WORKER_BASE_URL || "";
    this.units = APP.DEFAULT_UNITS || "metric";
    this.activeTab = "forecast";
    this.courseService = new CourseService({
      datasetBasePath: APP.DATASET_BASE_PATH || "../data/courses",
      defaultCountry: APP.DEFAULT_COUNTRY || "gb",
    });

    this.selectedCourse = null;
    this.norm = null;
    this.loading = false;
    this.error = null;

    this.holes = 18;
    this.selectedDateKey = null;
    this.selectedTeeTime = null;
    this.dayScores = {};

    this.searchQuery = "";
    this.searchResults = [];
    this.searchLoading = false;
    this.searchError = null;
    this.usStates = [];
  }

  async init() {
    const root = document.getElementById("app");
    if (!root) return;

    root.innerHTML = renderAppShell(this.activeTab);
    wireSheet();
    wireBottomNav((tab) => this.navigate(tab));

    try {
      await this.courseService.loadCatalog();
      this.usStates = await this.courseService.loadUsStates();
      await this.courseService.refreshDataset();
    } catch (err) {
      console.warn("[Fairway Rebuild] Init warning:", err);
    }

    this.render();
  }

  navigate(tab) {
    this.activeTab = tab;
    setActiveTab(tab);
    this.render();
    document.getElementById("fwMain")?.focus({ preventScroll: true });
  }

  async selectCourse(courseId) {
    const results = this.searchResults.length
      ? this.searchResults
      : this.courseService.search(this.searchQuery);
    const course = results.find((c) => c.id === courseId);
    if (!course) return;

    this.selectedCourse = course;
    this.selectedDateKey = null;
    this.selectedTeeTime = null;
    this.dayScores = {};
    this.error = null;
    this.navigate("forecast");
    await this.loadWeather();
  }

  async loadWeather() {
    if (!this.selectedCourse) return;

    this.loading = true;
    this.error = null;
    this.render();

    try {
      const raw = await fetchWeather(
        this.apiBase,
        this.selectedCourse.lat,
        this.selectedCourse.lon,
        this.units
      );
      this.norm = normalizeWeather(raw);
      this.initForecastState();
    } catch (err) {
      this.error = err.message || "Could not load weather forecast.";
      this.norm = null;
    } finally {
      this.loading = false;
      this.render();
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  }

  initForecastState() {
    const windowHours = getRoundDurationHours(this.holes);
    const dates = getAvailableDates(this.norm, windowHours);
    const firstValid = dates.find((d) => d.hasValidTimes) || dates[0];

    if (firstValid) {
      this.selectedDateKey = firstValid.dateKey;
      this.selectedTeeTime = getDefaultTeeTime(firstValid.date, this.norm, windowHours);
    }

    this.dayScores = {};
    for (const d of dates) {
      this.dayScores[d.dateKey] = calculateDayScore(this.norm, d.date, this.units, windowHours);
    }
  }

  getSelectedDate() {
    const windowHours = getRoundDurationHours(this.holes);
    const dates = getAvailableDates(this.norm, windowHours);
    return dates.find((d) => d.dateKey === this.selectedDateKey)?.date ?? null;
  }

  getForecastState() {
    const windowHours = getRoundDurationHours(this.holes);
    const dates = this.norm ? getAvailableDates(this.norm, windowHours) : [];
    const selectedDate = this.getSelectedDate();
    const teeTimes = selectedDate
      ? getValidTeeTimesForDate(selectedDate, this.norm, windowHours)
      : [];

    if (selectedDate && this.selectedTeeTime) {
      const valid = teeTimes.some((t) => t.value === this.selectedTeeTime);
      if (!valid) {
        this.selectedTeeTime = findNearestValidTime(teeTimes, this.selectedTeeTime);
      }
    }

    let scoreResult = null;
    let decision = null;
    let rainAnalysis = null;
    let impactCards = null;
    let betterTee = null;

    if (this.norm && this.selectedTeeTime) {
      const hourly = this.norm.hourly || [];
      decision = computeTeeTimeDecision(
        hourly,
        this.selectedTeeTime,
        windowHours,
        this.units,
        this.courseService.getCountry()
      );

      const windowData = hourly.filter((h) => {
        const end = this.selectedTeeTime + windowHours * 3600;
        return h.dt >= this.selectedTeeTime && h.dt < end;
      });

      scoreResult = calculateRoundScore(windowData, this.units);
      rainAnalysis = analyzeRainDuringRound(
        hourly,
        this.selectedTeeTime,
        windowHours,
        this.norm.timezoneOffset || 0
      );
      impactCards = getImpactCards(decision, scoreResult, this.units);

      if (selectedDate) {
        betterTee = findBetterTeeTime(
          this.norm,
          selectedDate,
          this.selectedTeeTime,
          windowHours,
          this.units,
          this.courseService.getCountry()
        );
      }
    }

    return {
      loading: this.loading,
      error: this.error,
      noCourse: !this.selectedCourse,
      days: dates,
      selectedDateKey: this.selectedDateKey,
      dayScores: this.dayScores,
      scoreResult,
      decision,
      teeTimes,
      selectedTeeTime: this.selectedTeeTime,
      holes: this.holes,
      windowHours,
      tzOffset: this.norm?.timezoneOffset || 0,
      rainAnalysis,
      impactCards,
      betterTee,
    };
  }

  async onSearch(query) {
    this.searchQuery = query;
    this.searchLoading = true;
    this.searchError = null;
    this.render();

    try {
      if (!this.courseService.currentFuse) {
        await this.courseService.refreshDataset();
      }
      this.searchResults = query.trim() ? this.courseService.search(query) : [];
    } catch (err) {
      this.searchError = "Could not search courses.";
      this.searchResults = [];
    } finally {
      this.searchLoading = false;
      this.render();
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  }

  async onCountryChange(code) {
    this.courseService.setCountry(code);
    try {
      await this.courseService.refreshDataset();
      if (code === "us") this.usStates = await this.courseService.loadUsStates();
    } catch {
      this.searchError = "Could not load courses for this region.";
    }
    this.searchResults = this.searchQuery ? this.courseService.search(this.searchQuery) : [];
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  async onStateChange(state) {
    this.courseService.setState(state);
    try {
      await this.courseService.refreshDataset();
    } catch {
      this.searchError = "Could not load courses for this state.";
    }
    this.searchResults = this.searchQuery ? this.courseService.search(this.searchQuery) : [];
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onDaySelect(dateKey) {
    this.selectedDateKey = dateKey;
    const windowHours = getRoundDurationHours(this.holes);
    const dates = getAvailableDates(this.norm, windowHours);
    const info = dates.find((d) => d.dateKey === dateKey);
    if (info?.date) {
      this.selectedTeeTime = getDefaultTeeTime(info.date, this.norm, windowHours);
    }
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onTeeTimeChange(teeTime) {
    this.selectedTeeTime = teeTime;
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onHolesChange(holes) {
    this.holes = holes;
    if (this.norm) this.initForecastState();
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  render() {
    mountCourseHeader(document.getElementById("fwCourseHeaderMount"), this.selectedCourse, {
      onChange: () => this.navigate("courses"),
    });

    const main = document.getElementById("fwMain");
    if (!main) return;

    if (this.activeTab === "home") {
      main.innerHTML = renderHomeView();
      wireHomeView(main, (tab) => this.navigate(tab));
    } else if (this.activeTab === "courses") {
      main.innerHTML = renderCoursesView({
        countries: this.courseService.getCountries(),
        country: this.courseService.getCountry(),
        state: this.courseService.getState(),
        usStates: this.usStates,
        query: this.searchQuery,
        results: this.searchResults,
        loading: this.searchLoading,
        error: this.searchError,
      });
      wireCoursesView(main, {
        onSearch: (q) => this.onSearch(q),
        onCountryChange: (c) => this.onCountryChange(c),
        onStateChange: (s) => this.onStateChange(s),
        onSelect: (id) => this.selectCourse(id),
      });
    } else if (this.activeTab === "forecast") {
      const state = this.getForecastState();
      main.innerHTML = renderForecastView(state);
      wireForecastView(main, {
        onNavigate: (tab) => this.navigate(tab),
        onRetry: () => this.loadWeather(),
        onDaySelect: (key) => this.onDaySelect(key),
        onTeeTimeChange: (t) => this.onTeeTimeChange(t),
        onHolesChange: (h) => this.onHolesChange(h),
        getScore: () => state.scoreResult?.score,
        getFactors: () => state.scoreResult?.factors,
        getDecision: () => state.decision,
        getBetterTee: () => state.betterTee,
      });
    } else if (this.activeTab === "rounds") {
      main.innerHTML = renderRoundsView();
    }

    if (typeof lucide !== "undefined") lucide.createIcons();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new FairwayApp();
  app.init();
});
