import {
  renderAppShell,
  wireBottomNav,
  setActiveTab,
  wireSheet,
  openSheet,
} from "./components/AppShell.js";
import { mountCourseHeader } from "./components/CourseHeader.js";
import { renderPremiumSheet } from "./components/PremiumLock.js";
import { renderForecastView, wireForecastView } from "./views/ForecastView.js";
import { renderHomeView, wireHomeView } from "./views/HomeView.js";
import { renderCoursesView, wireCoursesView } from "./views/CoursesView.js";
import { renderRoundsView, wireRoundsView } from "./views/RoundsView.js";
import { tabFromPath, syncHistory, wireHistory } from "./router.js";
import { CourseService } from "../../shared/course-service.js";
import {
  PersistenceService,
  createLastKnownForecast,
  favKey,
  normalizeCourse,
} from "../../shared/persistence.js";
import {
  fetchWeather,
  normalizeWeather,
  getWeatherMeta,
  formatForecastFreshness,
} from "../../shared/weather-service.js";
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
  summarizeCoursePlayability,
  isMaterialTeeShift,
} from "../../shared/forecast-engine.js";
import { weatherIdToIcon, scoreToVerdict } from "../../shared/utils.js";
import { formatRadiusLabel } from "../../shared/geo.js";
import { track, AnalyticsEvents } from "../../shared/analytics.js";

const APP = window.APP_CONFIG || {};
const FAV_FETCH_LIMIT = 5;

class FairwayApp {
  constructor() {
    this.apiBase = APP.WORKER_BASE_URL || "";
    this.units = APP.DEFAULT_UNITS || "metric";
    this.activeTab = tabFromPath();
    this.persistence = new PersistenceService();
    this.courseService = new CourseService({
      datasetBasePath: APP.DATASET_BASE_PATH || "/data/courses",
      defaultCountry: APP.DEFAULT_COUNTRY || "gb",
      persistence: this.persistence,
    });

    this.selectedCourse = null;
    this.norm = null;
    this.weatherMeta = null;
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

    this.nearbyResults = [];
    this.nearbyLoading = false;
    this.nearbyError = null;

    this.favouriteSummaries = new Map();
    this.favouriteLoading = false;
    this.roundSummaries = new Map();
    this.roundLoading = false;
    this.hourlyExpanded = false;
    this.roundJustSaved = false;
    this.openedRoundId = null;
    this.pendingRoundTee = null;
    this.teeAdjusted = null;
    this.homeViewed = false;
  }

  async init() {
    const root = document.getElementById("app");
    if (!root) return;

    this.registerPwa();

    root.innerHTML = renderAppShell(this.activeTab);
    wireSheet();
    wireBottomNav((tab) => this.navigate(tab));
    wireHistory((tab) => this.navigate(tab, { history: false }));

    try {
      await this.courseService.loadCatalog();
      this.usStates = await this.courseService.loadUsStates();
      await this.courseService.refreshDataset();
    } catch (err) {
      console.warn("[Fairway Rebuild] Init warning:", err);
    }

    const lastCourse = this.persistence.getLastCourse();
    if (lastCourse && (lastCourse.id || lastCourse.lat != null)) {
      this.selectedCourse = lastCourse;
      const pref = this.persistence.getTeeTimePreference();
      if (pref.dateKey) this.selectedDateKey = pref.dateKey;
      await this.loadWeather({ silent: false });
    }

    if (this.activeTab === "forecast" && !this.selectedCourse) {
      this.activeTab = "home";
    }

    this.render();
    this.maybeTrackHome();
    this.loadFavouriteSummaries();
    if (this.activeTab === "rounds") this.loadRoundSummaries();
    if (this.activeTab === "forecast") track(AnalyticsEvents.FORECAST_VIEWED);
  }

  registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/dev/sw.js", { scope: "/dev/" }).catch(() => {
      /* optional */
    });
  }

  navigate(tab, { history = true } = {}) {
    if (tab === "forecast" && !this.selectedCourse) {
      tab = "home";
    }
    this.activeTab = tab;
    if (history) syncHistory(tab);
    setActiveTab(this.activeTab);
    this.roundJustSaved = false;
    this.render();
    document.getElementById("fwMain")?.focus({ preventScroll: true });
    if (tab === "home") this.maybeTrackHome();
    if (tab === "forecast") track(AnalyticsEvents.FORECAST_VIEWED);
    if (tab === "home") this.loadFavouriteSummaries();
    if (tab === "rounds") this.loadRoundSummaries();
  }

  maybeTrackHome() {
    if (this.activeTab !== "home") return;
    if (this.homeViewed) return;
    this.homeViewed = true;
    track(AnalyticsEvents.HOME_VIEWED, { hasCourse: Boolean(this.selectedCourse) });
  }

  resolveCourse(courseId) {
    if (!courseId) return null;
    const pools = [
      this.searchResults,
      this.nearbyResults,
      this.persistence.getFavourites(),
      this.persistence.getRecentCourses(),
      this.selectedCourse ? [this.selectedCourse] : [],
      this.persistence.getSavedRounds().map((r) => r.course),
    ];
    for (const list of pools) {
      const found = (list || []).find((c) => c && (c.id === courseId || favKey(c) === `id:${courseId}`));
      if (found) return found;
    }
    return null;
  }

  async selectCourse(courseOrId, { source = "search" } = {}) {
    const course =
      typeof courseOrId === "object" && courseOrId ? normalizeCourse(courseOrId) : this.resolveCourse(courseOrId);
    if (!course) return;

    this.selectedCourse = course;
    this.persistence.saveLastCourse(course);
    this.error = null;
    this.openedRoundId = null;
    this.pendingRoundTee = null;
    this.teeAdjusted = null;
    this.roundJustSaved = false;
    track(AnalyticsEvents.COURSE_SELECTED, { source, name: course.name });
    this.navigate("forecast");
    await this.loadWeather();
  }

  toggleFavourite(courseOrId) {
    const course =
      typeof courseOrId === "object" && courseOrId ? courseOrId : this.resolveCourse(courseOrId);
    if (!course) return;
    const nowFav = this.persistence.toggleFavourite(course);
    track(nowFav ? AnalyticsEvents.COURSE_FAVOURITED : AnalyticsEvents.COURSE_UNFAVOURITED, {
      name: course.name,
    });
    this.render();
    if (nowFav) this.loadFavouriteSummaries();
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
      this.weatherMeta = getWeatherMeta(raw);
      this.norm = normalizeWeather(raw);
      this.initForecastState();
      if (this.openedRoundId) {
        const forecast = this.getForecastState();
        this.persistence.updateRoundForecast(
          this.openedRoundId,
          createLastKnownForecast(forecast.verdict, this.weatherMeta?.fetchedAt)
        );
      }
    } catch (err) {
      this.error = err.message || "Could not load weather forecast.";
      this.norm = null;
      this.weatherMeta = null;
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
    const tzOffset = this.norm?.timezoneOffset || 0;
    const restoringRound = Boolean(this.openedRoundId && this.pendingRoundTee);

    let dateInfo = dates.find((d) => d.dateKey === this.selectedDateKey);
    if (!restoringRound) {
      dateInfo =
        dates.find((d) => d.dateKey === this.selectedDateKey && d.hasValidTimes) ||
        dates.find((d) => d.dateKey === pref.dateKey && d.hasValidTimes) ||
        dates.find((d) => d.hasValidTimes) ||
        dates[0];
    }

    if (dateInfo) {
      this.selectedDateKey = dateInfo.dateKey;
      const teeTimes = getValidTeeTimesForDate(dateInfo.date, this.norm, windowHours);
      const requested = this.pendingRoundTee || this.selectedTeeTime || pref.teeTime;
      const exact = requested && teeTimes.some((t) => t.value === requested);

      if (exact) {
        this.selectedTeeTime = requested;
        if (restoringRound) this.teeAdjusted = null;
      } else if (teeTimes.length) {
        const nearest = findNearestValidTime(teeTimes, requested, tzOffset);
        this.selectedTeeTime = nearest;
        if (restoringRound) {
          const material = isMaterialTeeShift(requested, nearest, tzOffset);
          this.teeAdjusted = {
            requested,
            actual: nearest,
            material,
            sameDay: true,
          };
        }
      } else {
        this.selectedTeeTime = getDefaultTeeTime(dateInfo.date, this.norm, windowHours);
        if (restoringRound) {
          this.teeAdjusted = { requested, actual: this.selectedTeeTime, material: true, sameDay: true };
        }
      }
    }

    this.pendingRoundTee = null;
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

      rainAnalysis = analyzeRainDuringRound(hourly, this.selectedTeeTime, windowHours, tzOffset);
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
      hourly: this.norm?.hourly || [],
      units: this.units,
      freshness: formatForecastFreshness(this.weatherMeta),
      hourlyExpanded: this.hourlyExpanded,
      roundSaved: this.roundJustSaved,
      teeAdjusted: this.teeAdjusted,
      isFavourite: this.persistence.isFavourite(this.selectedCourse),
    };
  }

  getHomeState() {
    const forecast = this.getForecastState();
    const favs = this.persistence.getFavourites().slice(0, FAV_FETCH_LIMIT);
    const favouriteCards = favs.map((course) => ({
      course,
      summary: this.favouriteSummaries.get(favKey(course)) || null,
      loading: this.favouriteLoading && !this.favouriteSummaries.has(favKey(course)),
    }));

    const currentId = this.norm?.current?.weather?.[0]?.id;
    return {
      course: this.selectedCourse,
      weatherLoading: this.weatherLoading,
      verdict: forecast.verdict,
      selectedTeeTime: this.selectedTeeTime,
      tzOffset: forecast.tzOffset,
      bestDay: forecast.bestDay,
      holes: this.holes,
      isFavourite: this.persistence.isFavourite(this.selectedCourse),
      favouriteCards,
      freshness: forecast.freshness,
      weatherIcon: weatherIdToIcon(currentId),
      distanceUnits: this.distanceUnits(),
    };
  }

  distanceUnits() {
    const country = this.courseService.getCountry();
    if (this.units === "imperial" || country === "us") return "imperial";
    return "metric";
  }

  async loadFavouriteSummaries() {
    const favs = this.persistence.getFavourites().slice(0, FAV_FETCH_LIMIT);
    if (!favs.length) return;
    this.favouriteLoading = true;
    const tasks = favs.map(async (course) => {
      const key = favKey(course);
      if (this.favouriteSummaries.has(key)) return;
      if (!Number.isFinite(course.lat) || !Number.isFinite(course.lon)) return;
      try {
        const raw = await fetchWeather(this.apiBase, course.lat, course.lon, this.units);
        const norm = normalizeWeather(raw);
        const summary = summarizeCoursePlayability(norm, this.units, this.courseService.getCountry());
        if (summary) this.favouriteSummaries.set(key, summary);
      } catch {
        /* keep card without weather */
      }
    });
    await Promise.all(tasks);
    this.favouriteLoading = false;
    if (this.activeTab === "home") this.render();
  }

  async loadRoundSummaries() {
    const upcoming = this.persistence.getUpcomingRounds().slice(0, FAV_FETCH_LIMIT);
    if (!upcoming.length) return;
    this.roundLoading = true;
    const tasks = upcoming.map(async (round) => {
      if (this.roundSummaries.has(round.id)) return;
      const course = round.course;
      if (!Number.isFinite(course?.lat) || !Number.isFinite(course?.lon)) return;
      try {
        const raw = await fetchWeather(this.apiBase, course.lat, course.lon, this.units);
        const norm = normalizeWeather(raw);
        const windowHours = getRoundDurationHours(round.holes === 9 ? 9 : 18);
        const hourly = norm.hourly || [];
        const windowData = getWindowData(hourly, round.teeTime, windowHours);
        const verdict = computeGolfVerdict(
          windowData,
          hourly,
          round.teeTime,
          windowHours,
          this.units,
          course.country || this.courseService.getCountry(),
          norm.timezoneOffset || 0
        );
        this.roundSummaries.set(round.id, {
          score: verdict?.score ?? null,
          verdict: verdict?.verdict || scoreToVerdict(verdict?.score),
          message: verdict?.message || "",
          freshness: formatForecastFreshness(getWeatherMeta(raw)),
        });
      } catch {
        /* keep lastKnownForecast metadata on the card */
      }
    });
    await Promise.all(tasks);
    this.roundLoading = false;
    if (this.activeTab === "rounds") this.render();
  }

  async onSearch(query) {
    this.searchQuery = query;
    this.searchLoading = true;
    this.searchError = null;
    this.render();
    track(AnalyticsEvents.COURSE_SEARCH, { qLen: query.trim().length });

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

  async findNearbyCourses() {
    if (!navigator.geolocation) {
      this.nearbyError = "Location is unavailable on this device. Search by name instead.";
      this.navigate("courses");
      return;
    }

    this.nearbyLoading = true;
    this.nearbyError = null;
    this.nearbyResults = [];
    this.navigate("courses");

    const position = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ ok: true, pos }),
        (err) => resolve({ ok: false, err }),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 60_000 }
      );
    });

    this.nearbyLoading = false;

    if (!position.ok) {
      const code = position.err?.code;
      if (code === 1) this.nearbyError = "Location permission denied. You can still search by name.";
      else if (code === 3) this.nearbyError = "Location request timed out. Try again or search by name.";
      else this.nearbyError = "Location is unavailable. Try again or search by name.";
      this.render();
      return;
    }

    const { latitude, longitude } = position.pos.coords;
    try {
      if (!this.courseService.currentDocs?.length) {
        await this.courseService.refreshDataset();
      }
      this.nearbyResults = this.courseService.findNearby(latitude, longitude, 40, 12);
      if (!this.nearbyResults.length) {
        this.nearbyError = `No courses found within ${formatRadiusLabel(40, this.distanceUnits())}. Try searching by name.`;
      }
      track(AnalyticsEvents.NEARBY_COURSES_USED, { count: this.nearbyResults.length });
    } catch {
      this.nearbyError = "Could not look up nearby courses.";
    }
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
    track(AnalyticsEvents.FORECAST_DAY_CHANGED);
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onTeeTimeChange(teeTime) {
    this.selectedTeeTime = teeTime;
    this.roundJustSaved = false;
    this.teeAdjusted = null;
    this.persistence.saveTeeTimePreference(teeTime, this.selectedDateKey);
    track(AnalyticsEvents.TEE_TIME_CHANGED);
    this.render();
    if (typeof lucide !== "undefined") lucide.createIcons();
  }

  onHolesChange(holes) {
    const prevDateKey = this.selectedDateKey;
    const prevTeeTime = this.selectedTeeTime;
    this.holes = holes;
    this.persistence.saveHolesPreference(holes);
    track(AnalyticsEvents.HOLES_CHANGED, { holes });

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
    track(AnalyticsEvents.BETTER_TEE_TIME_USED);
    this.onTeeTimeChange(teeTime);
    document.getElementById("fwHeroMount")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  saveCurrentRound() {
    if (!this.selectedCourse || !this.selectedTeeTime) return;
    const forecast = this.getForecastState();
    const record = this.persistence.saveRound({
      course: this.selectedCourse,
      date: this.selectedDateKey,
      teeTime: this.selectedTeeTime,
      holes: this.holes,
      lastKnownForecast: createLastKnownForecast(forecast.verdict, this.weatherMeta?.fetchedAt),
    });
    this.openedRoundId = record?.id || this.openedRoundId;
    this.roundJustSaved = true;
    this.roundSummaries.delete(this.openedRoundId);
    track(AnalyticsEvents.ROUND_SAVED);
    this.render();
  }

  openBestWeek() {
    const best = this.getForecastState().bestDay;
    if (best?.dateKey) {
      this.selectedDateKey = best.dateKey;
      if (best.bestTeeTimeUnix) this.selectedTeeTime = best.bestTeeTimeUnix;
      this.persistence.saveTeeTimePreference(this.selectedTeeTime, best.dateKey);
    }
    this.navigate("forecast");
  }

  async openRound(id) {
    const round = this.persistence.getRound(id);
    if (!round?.course) return;
    this.selectedCourse = normalizeCourse(round.course);
    this.holes = round.holes === 9 ? 9 : 18;
    this.selectedDateKey = round.date;
    this.selectedTeeTime = round.teeTime;
    this.pendingRoundTee = round.teeTime;
    this.teeAdjusted = null;
    this.openedRoundId = round.id;
    this.persistence.saveLastCourse(round.course);
    this.persistence.saveHolesPreference(this.holes);
    this.persistence.saveTeeTimePreference(round.teeTime, round.date);
    track(AnalyticsEvents.ROUND_OPENED);
    this.navigate("forecast");
    await this.loadWeather();
  }

  deleteRound(id) {
    this.persistence.deleteRound(id);
    track(AnalyticsEvents.ROUND_DELETED);
    this.render();
  }

  async playAgain(id) {
    const round = this.persistence.getRound(id);
    if (!round?.course) return;
    this.selectedCourse = normalizeCourse(round.course);
    this.holes = round.holes === 9 ? 9 : 18;
    this.selectedDateKey = null;
    this.selectedTeeTime = null;
    this.openedRoundId = null;
    this.persistence.saveLastCourse(round.course);
    this.navigate("forecast");
    await this.loadWeather();
  }

  openPremium(id) {
    openSheet("Fairway Premium", renderPremiumSheet(id));
  }

  favouriteIdSet() {
    return new Set(this.persistence.getFavourites().map((c) => c.id).filter(Boolean));
  }

  render() {
    mountCourseHeader(document.getElementById("fwCourseHeaderMount"), this.selectedCourse, {
      onChange: () => this.navigate("courses"),
      isFavourite: this.persistence.isFavourite(this.selectedCourse),
      onToggleFavourite: (course) => this.toggleFavourite(course),
    });

    const main = document.getElementById("fwMain");
    if (!main) return;

    if (this.activeTab === "home") {
      main.innerHTML = renderHomeView(this.getHomeState());
      wireHomeView(main, {
        onNavigate: (tab) => this.navigate(tab),
        onSelectCourse: (id) => this.selectCourse(id, { source: "home" }),
        onGoForecast: () => this.navigate("forecast"),
        onOpenBestWeek: () => this.openBestWeek(),
        onNearby: () => this.findNearbyCourses(),
        onToggleFavourite: (id) => this.toggleFavourite(id),
        onPremium: (id) => this.openPremium(id),
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
        favouriteIds: this.favouriteIdSet(),
        nearby: this.nearbyResults,
        nearbyLoading: this.nearbyLoading,
        nearbyError: this.nearbyError,
        distanceUnits: this.distanceUnits(),
      });
      wireCoursesView(main, {
        onSearch: (q) => this.onSearch(q),
        onCountryChange: (c) => this.onCountryChange(c),
        onStateChange: (s) => this.onStateChange(s),
        onSelect: (id) => this.selectCourse(id, { source: this.nearbyResults.some((c) => c.id === id) ? "nearby" : "search" }),
        onNearby: () => this.findNearbyCourses(),
        onToggleFavourite: (id) => this.toggleFavourite(id),
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
        onSaveRound: () => this.saveCurrentRound(),
        onToggleFavourite: () => this.toggleFavourite(this.selectedCourse),
        onWhyScore: () => track(AnalyticsEvents.WHY_SCORE_OPENED),
        onHourlyExpand: () => {
          this.hourlyExpanded = true;
          track(AnalyticsEvents.HOURLY_EXPANDED);
        },
        onPremium: (id) => this.openPremium(id),
        getScore: () => state.verdict?.score,
        getFactors: () => state.verdict?.factors,
        getDecision: () => state.decision,
        getBetterTee: () => state.betterTee,
      });
    } else if (this.activeTab === "rounds") {
      main.innerHTML = renderRoundsView({
        upcoming: this.persistence.getUpcomingRounds(),
        past: this.persistence.getPastRounds(),
        summaries: this.roundSummaries,
        loading: this.roundLoading,
        units: this.units,
      });
      wireRoundsView(main, {
        onOpen: (id) => this.openRound(id),
        onDelete: (id) => this.deleteRound(id),
        onPlayAgain: (id) => this.playAgain(id),
      });
    }

    if (typeof lucide !== "undefined") lucide.createIcons();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new FairwayApp();
  app.init();
});
