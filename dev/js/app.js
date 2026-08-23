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
import { PersistenceService } from "../../shared/persistence.js";
import { fetchWeather, normalizeWeather } from "../../shared/weather-service.js";
import {
  getAvailableDates,
  getValidTeeTimesForDate,
  getRoundDurationHours,
  computeGolfVerdict,
  calculateDayScore,
  analyzeRainDuringRound,
  getImpactCards,
  findBetterTeeTime,
  findNearestValidTime,
  getDefaultTeeTime,
  getBestDayThisWeek,
  getWindowData,
} from "../../shared/forecast-engine.js";
import { dateToCourseKey } from "../../shared/timezone.js";

const APP = window.APP_CONFIG || {};

class FairwayApp {
  constructor() {
    this.apiBase = APP.WORKER_BASE_URL || "";
    this.units = APP.DEFAULT_UNITS || "metric";
    this.activeTab = "home";
    this.courseService = new CourseService({
      datasetBasePath: APP.DATASET_BASE_PATH || "../data/courses",
      defaultCountry: APP.DEFAULT_COUNTRY || "gb",
    });
    this.persistence = new PersistenceService();

    this.selectedCourse = null;
    this.norm = null;
    this.weatherLoading = false;
    this.error = null;

    this.holes = this.persistence.getHolesPreference();
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

    const lastCourse = this.persistence.getLastCourse();
    if (lastCourse?.id) {
      const found = this.courseService.search(lastCourse.name).find((c) => c.id === lastCourse.id);
      this.selectedCourse = found || lastCourse;
      const pref = this.persistence.getTeeTimePreference();
      if (pref.dateKey) this.selectedDateKey = pref.dateKey;
      this.activeTab = "home";
      await this.loadWeather({ silent: false });
    }

    this.render();
  }

  navigate(tab) {
    if (tab === "forecast" && !this.selectedCourse) {
      this.activeTab = "home";
    } else {
      this.activeTab = tab;
    }
    setActiveTab(this.activeTab);
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
    this.persistence.saveLastCourse(course);
    this.error = null;
    this.navigate("forecast");
    await this.loadWeather();
  }

  async loadWeather({ silent = false } = {}) {
    if (!this.selectedCourse) return;

    this.weatherLoading = true;
    if (!silent) this.error = null;
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
      this.weatherLoading = false;
      this.render();
      if (typeof lucide !== "undefined") lucide.createIcons();
    }
  }

  initForecastState() {
    const windowHours = getRoundDurationHours(this.holes);
    const dates = getAvailableDates(this.norm, windowHours);
    const pref = this.persistence.getTeeTimePreference();

    let dateInfo =
      dates.find((d) => d.dateKey === this.selectedDateKey && d.hasValidTimes) ||
      dates.find((d) => d.dateKey === pref.dateKey && d.hasValidTimes) ||
      dates.find((d) => d.hasValidTimes) ||
      dates[0];

    if (dateInfo) {
      this.selectedDateKey = dateInfo.dateKey;
      const teeTimes = getValidTeeTimesForDate(dateInfo.date, this.norm, windowHours);
      const prefValid = pref.teeTime && teeTimes.some((t) => t.value === pref.teeTime);
      this.selectedTeeTime = prefValid
        ? pref.teeTime
        : this.selectedTeeTime && teeTimes.some((t) => t.value === this.selectedTeeTime)
          ? this.selectedTeeTime
          : getDefaultTeeTime(dateInfo.date, this.norm, windowHours);
    }

    this.recalculateDayScores();
  }

  recalculateDayScores() {
    const windowHours = getRoundDurationHours(this.holes);
    const dates = this.norm ? getAvailableDates(this.norm, windowHours) : [];
    this.dayScores = {};
    for (const d of dates) {
      this.dayScores[d.dateKey] = calculateDayScore(
        this.norm,
        d.date,
        this.units,
        windowHours,
        this.courseService.getCountry()
      );
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
    const tzOffset = this.norm?.timezoneOffset || 0;
    const teeTimes = selectedDate
      ? getValidTeeTimesForDate(selectedDate, this.norm, windowHours)
      : [];

    if (selectedDate && this.selectedTeeTime) {
      const valid = teeTimes.some((t) => t.value === this.selectedTeeTime);
      if (!valid) {
        this.selectedTeeTime = findNearestValidTime(teeTimes, this.selectedTeeTime, tzOffset);
      }
    }

    let verdict = null;
    let rainAnalysis = null;
    let impactCards = null;
    let betterTee = null;

    if (this.norm && this.selectedTeeTime) {
      const hourly = this.norm.hourly || [];
      const windowData = getWindowData(hourly, this.selectedTeeTime, windowHours);

      verdict = computeGolfVerdict(
        windowData,
        hourly,
        this.selectedTeeTime,
        windowHours,
        this.units,
        this.courseService.getCountry(),
        tzOffset
      );

      rainAnalysis = analyzeRainDuringRound(
        hourly,
        this.selectedTeeTime,
        windowHours,
        tzOffset
      );
      impactCards = getImpactCards(verdict, this.units);

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
      weatherLoading: this.weatherLoading,
      error: this.error,
      noCourse: !this.selectedCourse,
      days: dates,
      selectedDateKey: this.selectedDateKey,
      dayScores: this.dayScores,
      verdict,
      scoreResult: verdict
        ? { score: verdict.score, factors: verdict.factors, status: verdict.status }
        : null,
      decision: verdict
        ? {
            label: verdict.label,
            message: verdict.message,
            metrics: verdict.metrics,
            reasons: verdict.reasons,
          }
        : null,
      teeTimes,
      selectedTeeTime: this.selectedTeeTime,
      holes: this.holes,
      windowHours,
      tzOffset,
      rainAnalysis,
      impactCards,
      betterTee,
      course: this.selectedCourse,
      bestDay: getBestDayThisWeek(this.dayScores, dates),
    };
  }

  getHomeState() {
    const forecast = this.getForecastState();
    return {
      course: this.selectedCourse,
      weatherLoading: this.weatherLoading,
      verdict: forecast.verdict,
      selectedTeeTime: this.selectedTeeTime,
      tzOffset: forecast.tzOffset,
      bestDay: forecast.bestDay,
      recentCourses: this.persistence.getRecentCourses(),
      holes: this.holes,
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
    } catch {
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
      const tzOffset = this.norm?.timezoneOffset || 0;
      const teeTimes = getValidTeeTimesForDate(info.date, this.norm, windowHours);
      this.selectedTeeTime =
        findNearestValidTime(teeTimes, this.selectedTeeTime, tzOffset) ||
        getDefaultTeeTime(info.date, this.norm, windowHours);
      this.persistence.saveTeeTimePreference(this.selectedTeeTime, dateKey);
    }
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onTeeTimeChange(teeTime) {
    this.selectedTeeTime = teeTime;
    this.persistence.saveTeeTimePreference(teeTime, this.selectedDateKey);
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onHolesChange(holes) {
    const prevDateKey = this.selectedDateKey;
    const prevTeeTime = this.selectedTeeTime;
    this.holes = holes;
    this.persistence.saveHolesPreference(holes);

    if (!this.norm) {
      this.render();
      return;
    }

    const windowHours = getRoundDurationHours(this.holes);
    const dates = getAvailableDates(this.norm, windowHours);
    const tzOffset = this.norm?.timezoneOffset || 0;

    let dateInfo = dates.find((d) => d.dateKey === prevDateKey && d.hasValidTimes);
    if (!dateInfo) dateInfo = dates.find((d) => d.hasValidTimes) || dates[0];

    if (dateInfo) {
      this.selectedDateKey = dateInfo.dateKey;
      const teeTimes = getValidTeeTimesForDate(dateInfo.date, this.norm, windowHours);
      const stillValid = prevTeeTime && teeTimes.some((t) => t.value === prevTeeTime);
      this.selectedTeeTime = stillValid
        ? prevTeeTime
        : findNearestValidTime(teeTimes, prevTeeTime, tzOffset) ||
          getDefaultTeeTime(dateInfo.date, this.norm, windowHours);
      this.persistence.saveTeeTimePreference(this.selectedTeeTime, this.selectedDateKey);
    }

    this.recalculateDayScores();
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onUseBetterTee(teeTime) {
    this.onTeeTimeChange(teeTime);
    document.getElementById("fwHeroMount")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  render() {
    mountCourseHeader(document.getElementById("fwCourseHeaderMount"), this.selectedCourse, {
      onChange: () => this.navigate("courses"),
    });

    const main = document.getElementById("fwMain");
    if (!main) return;

    if (this.activeTab === "home") {
      main.innerHTML = renderHomeView(this.getHomeState());
      wireHomeView(main, {
        onNavigate: (tab) => this.navigate(tab),
        onSelectCourse: (id) => this.selectCourse(id),
        onGoForecast: () => this.navigate("forecast"),
      });
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
        recentCourses: this.persistence.getRecentCourses(),
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
        onUseBetterTee: (t) => this.onUseBetterTee(t),
        getScore: () => state.verdict?.score,
        getFactors: () => state.verdict?.factors,
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
