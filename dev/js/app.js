import {
  renderAppShell,
  wireBottomNav,
  setActiveTab,
  wireSheet,
} from "./components/AppShell.js?v=20261004-caddie";
import { mountCourseHeader } from "./components/CourseHeader.js?v=20261002-share";
import { renderPremiumLocks, renderPremiumSheet } from "./components/PremiumLock.js?v=20261003-free";
import { renderForecastView, wireForecastView } from "./views/ForecastView.js?v=20261004-caddie";
import {
  renderShotCaddieView,
  renderShotResult,
  wireShotCaddieView,
  formatWindLine,
} from "./views/ShotCaddieView.js?v=20261004-compass";
import { createShotCompass } from "./shot-compass.js?v=20261004-compass";
import {
  classifyWindOnShot,
  windArrowRelativeToShot,
  windRelativeToShot,
} from "../../shared/wind-caddie.js";
import { renderHomeView, wireHomeView } from "./views/HomeView.js?v=20261003-free";
import { renderCoursesView, wireCoursesView } from "./views/CoursesView.js?v=20261002-share";
import { renderRoundsView, wireRoundsView } from "./views/RoundsView.js";
import { renderAlertsView, wireAlerts } from "./views/AlertsView.js";
import { renderSocietyView, wireSocietyView } from "./views/SocietyView.js";
import { renderAccountView, wireAccountView } from "./views/AccountView.js?v=20261003-free";
import { renderSettingsView, wireSettingsView } from "./views/SettingsView.js?v=20261003-free";
import { tabFromPath, syncHistory, wireHistory } from "./router.js?v=20261004-caddie";
import { featureOn, isAdvancedDev } from "./features/gates.js?v=20261003-free";
import { closeSheet, openSheet } from "./components/AppShell.js?v=20261004-caddie";
import { renderMoreMenu } from "./components/MoreMenu.js";
import { renderSoftGate, wireSoftGate } from "./components/SoftGate.js";
import { renderExtendedOutlook } from "./components/ExtendedOutlook.js";
import { loadRadarFoundation, renderRadarPanel } from "./components/RadarPanel.js";
import { buildExtendedOutlook } from "./outlook/extendedOutlook.js";
import { generateSocietySlots } from "./society/societySlots.js";
import { compareRoundWeather, suppressDuplicateAlerts } from "./alerts/compareRoundWeather.js";
import { getSeenFingerprints, rememberSeenFingerprint } from "./alerts/alertStore.js";
import { createNotificationAdapter } from "./alerts/notificationAdapter.js";
import {
  canAccess,
  FREE_SAVED_ROUND_LIMIT,
  getEntitlementTier,
  setEntitlementTier,
} from "./entitlements/entitlements.js?v=20261003-free";
import { devFeatures } from "./config/devFeatures.js?v=20261003-free";
import { selectSponsoredPlacement } from "./monetisation/placement.js";
import { renderAdsenseSlot, renderSponsoredGolfCard } from "./monetisation/SponsoredGolfCard.js";
import { DevAnalyticsEvents, trackDevEvent } from "./analytics/analytics.js?v=20261003-free";
import { renderEveningPractice } from "./components/EveningPractice.js";
import { loadDevDaylightSeries } from "./daylight/daylightRequest.js";
import {
  buildPracticePlan,
  courseTodayKey,
  eveningFocusFrom,
  focusEveningHours,
  normalizePracticeHoles,
} from "./daylight/eveningPractice.js";
import { loadGolferPreferences, saveGolferPreferences } from "./preferences/golferPreferences.js";
import { loadDevGroundSignals } from "./ground/groundRequest.js";
import { buildForecastDimensions } from "./dimensions/forecastDimensions.js";
import { renderForecastDimensions } from "./components/ForecastDimensions.js";
import { applyRoundEdit } from "./rounds/editRound.js";
import { forgetRoundWeather, getRoundWeatherPair, recordRoundWeather } from "./rounds/roundWeatherHistory.js";
import { CourseService } from "../../shared/course-service.js?v=20261002-share";
import {
  PersistenceService,
  createLastKnownForecast,
  favKey,
  normalizeCourse,
  sameRoundPlan,
} from "../../shared/persistence.js?v=20261002-share";
import { encodeCourseParam, readCourseParam, shareCourseLink } from "../../shared/course-share.js?v=20261002-share";
import { showShareCopied } from "./components/ShareCourseButton.js?v=20261002-share";
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
import { noteShotCaddieOpened, trackShotCaddieEvent, ShotCaddieEvents } from "../../shared/shot-caddie-analytics.js?v=20261004-caddie";
import { shotConditionsFromForecast, recommendShot } from "../../shared/shot-recommendation.js?v=20261004-caddie";
import {
  loadShotClubs,
  saveShotClubs,
  setShotClubCarry,
  setShotClubUnits,
  loadShotSetup,
  saveShotSetup,
} from "../../shared/shot-clubs.js?v=20261004-caddie";

const APP = window.APP_CONFIG || {};
const FAV_FETCH_LIMIT = 5;

function defaultDateKey() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

function firstWetHour(analysis) {
  const wet = (analysis?.hours || []).find((hour) => hour.rainfallMm >= 0.2 || hour.probability >= 50);
  return wet?.dt ?? null;
}

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
    this.sharedCourseParam = "";
    this.sharedCourseMissing = false;
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
    this.searchRequestId = 0;
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
    this.shotTarget = "";
    this.shotPanel = "shot";
    this.shotBag = null;
    this.shotSetup = null;
    this.shotVisitOpen = false;
    this.shotDistanceTracked = "";
    this.shotRecSig = "";
    this.shotCompass = null;
    this.shotCompassStatus = "";
    this.shotCompassStarted = false;
    this.shotWindManual = false;
    this.shotGpsRequested = false;
    this.editingRoundId = null;
    this.roundLimitNote = "";
    this.roundAlerts = [];
    this.alertsLocked = false;
    this.outlookTracked = false;
    this.radarTracked = false;
    this.sponsorTracked = false;
    this.practiceHoles = 9;
    this.daylightSeries = [];
    this.eveningTracked = false;
    this.groundSignals = null;
    this.societyForm = {
      courseId: "",
      date: defaultDateKey(),
      firstTee: "08:00",
      interval: 10,
      groups: 8,
      players: 4,
    };
    this.societyResult = null;
    this.societyError = null;
    this.societyLoading = false;
    this.notifications = createNotificationAdapter({ mode: "in_app_only" });
  }

  async init() {
    const root = document.getElementById("app");
    if (!root) return;

    try {
      this.sharedCourseParam = readCourseParam(location.search);
    } catch {
      this.sharedCourseParam = "";
    }

    const restorePath = sessionStorage.getItem("fwDevRestorePath");
    if (restorePath) {
      sessionStorage.removeItem("fwDevRestorePath");
      try {
        const tab = tabFromPath(restorePath);
        history.replaceState({ tab }, "", restorePath);
        this.activeTab = tab;
      } catch {
        /* ignore invalid restore paths */
      }
    }

    this.registerPwa();

    root.innerHTML = renderAppShell(this.activeTab);
    wireSheet();
    document.getElementById("fwMoreBtn")?.addEventListener("click", () => this.openMore());
    wireBottomNav((tab) => this.navigate(tab));
    wireHistory((tab) => this.navigate(tab, { history: false }));

    try {
      await this.courseService.loadCatalog();
      this.usStates = await this.courseService.loadUsStates();
      await this.courseService.refreshDataset();
    } catch (err) {
      console.warn("[Fairway Rebuild] Init warning:", err);
    }

    if (this.sharedCourseParam) {
      try {
        const shared = await this.courseService.openSharedCourse(this.sharedCourseParam);
        if (shared?.id) {
          await this.selectCourse(shared, { source: "share" });
        } else {
          this.sharedCourseMissing = true;
        }
      } catch (err) {
        console.warn("[Fairway Rebuild] Shared course warning:", err);
        this.sharedCourseMissing = true;
      }
    }

    if (!this.selectedCourse && !this.sharedCourseMissing) {
      const lastCourse = this.persistence.getLastCourse();
      if (lastCourse && (lastCourse.id || lastCourse.lat != null)) {
        this.selectedCourse = this.withDataset(lastCourse);
        const pref = this.persistence.getTeeTimePreference();
        if (pref.dateKey) this.selectedDateKey = pref.dateKey;
        await this.loadWeather({ silent: false });
      }
    }

    if (this.sharedCourseMissing) {
      this.selectedCourse = null;
      this.activeTab = "home";
      syncHistory("home", { replace: true, course: this.sharedCourseParam });
    }

    if (this.activeTab === "forecast" && !this.selectedCourse) {
      this.activeTab = "home";
    }

    this.render();
    this.maybeTrackHome();
    this.loadFavouriteSummaries();
    if (this.activeTab === "rounds") this.loadRoundSummaries();
    if (this.activeTab === "forecast") track(AnalyticsEvents.FORECAST_VIEWED);
    if (this.activeTab === "caddie") this.markShotCaddieVisit();
  }

  registerPwa() {
    if (!("serviceWorker" in navigator)) return;
    const onDev = /\/dev(?:\/|$)/i.test(location.pathname || "");
    if (!onDev) {
      const hadController = Boolean(navigator.serviceWorker.controller);
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) =>
          Promise.all(
            registrations
              .filter((registration) => new URL(registration.scope).pathname === "/")
              .map((registration) => registration.unregister())
          )
        )
        .then(() => {
          if (!hadController) return;
          const key = "fw-production-worker-retired";
          if (sessionStorage.getItem(key) === "1") return;
          sessionStorage.setItem(key, "1");
          location.reload();
        })
        .catch(() => {
          /* best-effort cleanup of the retired production worker */
        });
      return;
    }

    navigator.serviceWorker
      .register("/dev/sw.js", { scope: "/dev/", updateViaCache: "none" })
      .then((registration) => registration.update())
      .catch(() => {
        /* optional */
      });
  }

  navigate(tab, { history = true } = {}) {
    if (tab === "forecast" && !this.selectedCourse) {
      tab = "home";
    }
    if (tab !== "caddie") {
      this.shotVisitOpen = false;
      this.stopShotCompass();
      this.shotCompassStarted = false;
    }
    this.activeTab = tab;
    if (history) {
      const course = tab === "forecast" ? this.shareParam() : this.sharedCourseMissing ? this.sharedCourseParam : "";
      syncHistory(tab, { course: course || undefined });
    }
    setActiveTab(this.activeTab);
    this.roundJustSaved = false;
    this.render();
    document.getElementById("fwMain")?.focus({ preventScroll: true });
    if (tab === "home") this.maybeTrackHome();
    if (tab === "forecast") track(AnalyticsEvents.FORECAST_VIEWED);
    if (tab === "home") this.loadFavouriteSummaries();
    if (tab === "rounds") this.loadRoundSummaries();
    if (isAdvancedDev() && tab === "alerts") trackDevEvent(DevAnalyticsEvents.ALERT_VIEWED);
    if (isAdvancedDev() && tab === "settings") trackDevEvent(DevAnalyticsEvents.SETTINGS_VIEWED);
    if (isAdvancedDev() && tab === "account") trackDevEvent(DevAnalyticsEvents.ACCOUNT_VIEWED);
    if (tab === "caddie") this.markShotCaddieVisit();
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

  withDataset(course) {
    if (!course) return course;
    const fromCourse = String(course.datasetCountry || course.country || "").toLowerCase();
    const country = /^[a-z]{2}$/.test(fromCourse)
      ? fromCourse
      : String(this.courseService.getCountry() || "").toLowerCase();
    let state = String(course.datasetState || "");
    if (!state && country === "us" && this.courseService.getCountry() === "us") {
      state = this.courseService.getState();
    }
    return normalizeCourse({ ...course, datasetCountry: country, datasetState: state });
  }

  shareParam(course = this.selectedCourse) {
    if (!course?.id) return "";
    return encodeCourseParam({
      id: course.id,
      country: course.datasetCountry || course.country,
      state: course.datasetState || "",
    });
  }

  async onShareCourse() {
    const course = this.selectedCourse;
    if (!course?.id) return;
    const result = await shareCourseLink({
      id: course.id,
      name: course.name,
      country: course.datasetCountry || course.country,
      state: course.datasetState || "",
    });
    if (result.method === "copy") showShareCopied(document);
  }

  async selectCourse(courseOrId, { source = "search" } = {}) {
    const resolved =
      typeof courseOrId === "object" && courseOrId ? courseOrId : this.resolveCourse(courseOrId);
    if (!resolved) return;
    const course = this.withDataset(resolved);

    this.sharedCourseMissing = false;
    this.selectedCourse = course;
    this.persistence.saveLastCourse(course);
    this.daylightSeries = [];
    this.eveningTracked = false;
    this.groundSignals = null;
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
      if (isAdvancedDev() && featureOn("eveningPractice")) {
        await this.ensureDaylight();
      }
      if (isAdvancedDev() && featureOn("groundConditionRisk")) {
        await this.ensureGround();
      } else {
        this.groundSignals = null;
      }
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
      this.groundSignals = null;
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
      weatherIcon: weatherIdToIcon(
        this.norm?.hourly?.find((h) => h.dt >= (this.selectedTeeTime || 0))?.weather?.[0]?.id ??
          this.norm?.current?.weather?.[0]?.id
      ),
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
      showFavourites: featureOn("favouriteCourses"),
    };
  }

  distanceUnits() {
    const country = this.courseService.getCountry();
    if (this.units === "imperial" || country === "us") return "imperial";
    return "metric";
  }

  async loadFavouriteSummaries() {
    if (isAdvancedDev() && !featureOn("favouriteCourses")) return;
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
    if (isAdvancedDev() && !featureOn("savedRounds")) return;
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
        const rainAnalysis = analyzeRainDuringRound(
          hourly,
          round.teeTime,
          windowHours,
          norm.timezoneOffset || 0
        );
        this.roundSummaries.set(round.id, {
          score: verdict?.score ?? null,
          verdict: verdict?.verdict || scoreToVerdict(verdict?.score),
          message: verdict?.message || "",
          freshness: formatForecastFreshness(getWeatherMeta(raw)),
          rainProbability: verdict?.metrics?.maxPrecipProb ?? null,
          metrics: verdict?.metrics || {},
          rainStartUnix: firstWetHour(rainAnalysis),
          checkedAt: getWeatherMeta(raw)?.fetchedAt || Date.now(),
        });
      } catch {
        /* keep lastKnownForecast metadata on the card */
      }
    });
    await Promise.all(tasks);
    this.roundLoading = false;
    this.rememberRoundWeather();
    this.syncRoundAlerts();
    if (this.activeTab === "rounds" || this.activeTab === "alerts") this.render();
  }

  async onSearch(query) {
    const requestId = ++this.searchRequestId;
    const restoreFocus = document.activeElement?.id === "fwCourseSearch";
    this.searchQuery = query;
    this.searchError = null;
    track(AnalyticsEvents.COURSE_SEARCH, { qLen: query.trim().length });

    try {
      if (!this.courseService.currentDocs.length) {
        this.searchLoading = true;
        this.render();
        await this.courseService.refreshDataset();
      }
      if (requestId !== this.searchRequestId) return;
      this.searchResults = query.trim() ? this.courseService.search(query) : [];
    } catch {
      if (requestId !== this.searchRequestId) return;
      this.searchError = "Could not search courses.";
      this.searchResults = [];
    } finally {
      if (requestId !== this.searchRequestId) return;
      this.searchLoading = false;
      this.render();
      if (restoreFocus) {
        requestAnimationFrame(() => {
          const input = document.getElementById("fwCourseSearch");
          if (!input || this.searchQuery !== query) return;
          input.focus({ preventScroll: true });
          input.setSelectionRange?.(input.value.length, input.value.length);
        });
      }
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
    if (isAdvancedDev() && !featureOn("nearbyCourses")) return;
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
    if (isAdvancedDev() && !featureOn("savedRounds")) return;
    if (!this.selectedCourse || !this.selectedTeeTime) return;
    const forecast = this.getForecastState();
    if (isAdvancedDev() && !canAccess("unlimitedSavedRounds", getEntitlementTier())) {
      const planned = {
        course: this.selectedCourse,
        date: this.selectedDateKey,
        teeTime: this.selectedTeeTime,
      };
      const updating = this.persistence.getRounds().some((round) => sameRoundPlan(round, planned));
      if (!updating && this.persistence.getRounds().length >= FREE_SAVED_ROUND_LIMIT) {
        this.roundLimitNote = `Free preview keeps ${FREE_SAVED_ROUND_LIMIT} saved rounds. Delete one, or switch to Premium preview in Account.`;
        this.render();
        return;
      }
    }
    this.roundLimitNote = "";
    const snapshot = this.snapshotFromForecast(forecast);
    const record = this.persistence.saveRound({
      course: this.selectedCourse,
      date: this.selectedDateKey,
      teeTime: this.selectedTeeTime,
      holes: this.holes,
      lastKnownForecast: createLastKnownForecast(forecast.verdict, this.weatherMeta?.fetchedAt),
    });
    if (record?.id && isAdvancedDev()) recordRoundWeather(record.id, snapshot, { seedOriginal: snapshot });
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
    if (isAdvancedDev()) forgetRoundWeather(id);
    if (this.editingRoundId === id) this.editingRoundId = null;
    track(AnalyticsEvents.ROUND_DELETED);
    this.syncRoundAlerts();
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

  coursesViewProps() {
    return {
      countries: this.courseService.getCountries(),
      country: this.courseService.getCountry(),
      state: this.courseService.getState(),
      usStates: this.usStates,
      query: this.searchQuery,
      results: this.searchResults,
      loading: this.searchLoading,
      error: this.searchError,
      recentCourses: this.persistence.getRecentCourses(),
      favouriteCourses: this.persistence.getFavourites(),
      favouriteIds: this.favouriteIdSet(),
      nearby: this.nearbyResults,
      nearbyLoading: this.nearbyLoading,
      nearbyError: this.nearbyError,
      distanceUnits: this.distanceUnits(),
      showFavourites: featureOn("favouriteCourses"),
      showRecents: true,
      showNearby: featureOn("nearbyCourses"),
      unresolvedShare: this.sharedCourseMissing,
    };
  }

  wireCourses(container) {
    wireCoursesView(container, {
      onSearch: (q) => this.onSearch(q),
      onCountryChange: (c) => this.onCountryChange(c),
      onStateChange: (s) => this.onStateChange(s),
      onSelect: (id) =>
        this.selectCourse(id, {
          source: this.nearbyResults.some((c) => c.id === id) ? "nearby" : "search",
        }),
      onNearby: () => this.findNearbyCourses(),
      onToggleFavourite: (id) => this.toggleFavourite(id),
    });
  }

  snapshotFromForecast(forecast) {
    const verdict = forecast?.verdict;
    return {
      score: verdict?.score ?? null,
      rainProbability: verdict?.metrics?.maxPrecipProb ?? null,
      rainMm: verdict?.metrics?.totalPrecipMm ?? null,
      wind: verdict?.metrics?.avgWind ?? null,
      gust: verdict?.metrics?.maxGust ?? null,
      tempC: verdict?.metrics?.avgTemp ?? null,
      rainStartUnix: firstWetHour(forecast?.rainAnalysis),
      checkedAt: this.weatherMeta?.fetchedAt || Date.now(),
    };
  }

  rememberRoundWeather() {
    if (!isAdvancedDev() || !featureOn("savedRounds")) return;
    for (const round of this.persistence.getUpcomingRounds()) {
      const summary = this.roundSummaries.get(round.id);
      if (!summary) continue;
      recordRoundWeather(
        round.id,
        {
          score: summary.score,
          rainProbability: summary.rainProbability,
          rainMm: summary.metrics?.totalPrecipMm ?? null,
          wind: summary.metrics?.avgWind ?? null,
          gust: summary.metrics?.maxGust ?? null,
          tempC: summary.metrics?.avgTemp ?? null,
          rainStartUnix: summary.rainStartUnix ?? null,
          checkedAt: summary.checkedAt || Date.now(),
        },
        { seedOriginal: round.lastKnownForecast }
      );
    }
  }

  syncRoundAlerts() {
    if (!isAdvancedDev() || !featureOn("weatherAlerts")) {
      this.roundAlerts = [];
      this.alertsLocked = false;
      return;
    }
    if (!canAccess("weatherAlerts", getEntitlementTier())) {
      this.roundAlerts = [];
      this.alertsLocked = true;
      return;
    }
    this.alertsLocked = false;
    const alerts = [];
    for (const round of this.persistence.getUpcomingRounds()) {
      const pair = getRoundWeatherPair(round.id);
      if (!pair?.original || !pair?.latest) continue;
      const betterTee = this.openedRoundId === round.id ? this.getForecastState().betterTee : null;
      alerts.push(...compareRoundWeather(pair.original, pair.latest, { roundId: round.id, betterTee }));
    }
    this.roundAlerts = suppressDuplicateAlerts(alerts, getSeenFingerprints());
  }

  dismissAlert(fingerprint) {
    rememberSeenFingerprint(fingerprint);
    this.syncRoundAlerts();
    trackDevEvent(DevAnalyticsEvents.ALERT_DISMISSED);
    this.render();
  }

  historyByRound() {
    const map = {};
    if (!isAdvancedDev() || !featureOn("savedRounds")) return map;
    for (const round of this.persistence.getRounds()) {
      const pair = getRoundWeatherPair(round.id);
      if (pair) map[round.id] = pair;
    }
    return map;
  }

  async ensureGround() {
    if (!isAdvancedDev() || !featureOn("groundConditionRisk") || !this.norm || !this.selectedCourse) {
      this.groundSignals = null;
      return;
    }
    try {
      this.groundSignals = await loadDevGroundSignals(this.norm, {
        lat: this.selectedCourse.lat,
        lon: this.selectedCourse.lon,
        units: this.units,
        allowFetch: true,
      });
    } catch {
      this.groundSignals = { pastRain: null, freezing: null, drying: null, source: "unavailable" };
    }
  }

  practicePreferenceInputs() {
    if (!isAdvancedDev() || !featureOn("golferPreferences")) return {};
    try {
      const prefs = loadGolferPreferences();
      return {
        paceMins: prefs.paceMins,
        daylightSafetyMarginMins: prefs.daylightSafetyMarginMins,
      };
    } catch {
      return {};
    }
  }

  async ensureDaylight() {
    if (
      !isAdvancedDev() ||
      !featureOn("eveningPractice") ||
      !canAccess("eveningPractice", getEntitlementTier()) ||
      !this.norm ||
      !this.selectedCourse
    ) {
      this.daylightSeries = [];
      return;
    }
    this.daylightSeries = await loadDevDaylightSeries(this.norm, {
      lat: this.selectedCourse.lat,
      lon: this.selectedCourse.lon,
    });
  }

  eveningPracticeHtml() {
    if (!isAdvancedDev() || !featureOn("eveningPractice") || !this.norm) return "";
    const tzOffset = this.norm.timezoneOffset || 0;
    const series = this.daylightSeries || [];
    const daylight = series.find((day) => day.date === this.selectedDateKey) || null;
    if (!daylight) return renderEveningPractice({ unavailable: true });

    const now = Math.floor(Date.now() / 1000);
    const plan = buildPracticePlan({
      holes: this.practiceHoles,
      daylight,
      upcoming: series,
      hourly: this.norm.hourly || [],
      now,
      units: this.units,
      countryCode: this.courseService.getCountry(),
      tzOffset,
      ...this.practicePreferenceInputs(),
    });
    const dateIsToday = courseTodayKey(now, daylight.timezone, tzOffset) === daylight.date;
    const from = eveningFocusFrom({
      now,
      teeTimeUnix: this.selectedTeeTime,
      lastPlayableLight: daylight.lastPlayableLight,
      sunrise: daylight.sunrise,
      dateIsToday,
    });
    const hours = focusEveningHours(this.norm.hourly || [], from, daylight.lastPlayableLight);
    if (!this.eveningTracked) {
      this.eveningTracked = true;
      trackDevEvent(DevAnalyticsEvents.EVENING_PRACTICE_VIEWED, {
        holes: plan.holes,
        daylightStatus: plan.daylightStatus,
      });
    }
    return renderEveningPractice({
      daylight,
      plan,
      hours,
      tzOffset,
      units: this.units,
    });
  }

  onPracticeHoles(holes) {
    const next = normalizePracticeHoles(holes);
    if (next === this.practiceHoles) return;
    this.practiceHoles = next;
    trackDevEvent(DevAnalyticsEvents.PRACTICE_HOLES_SELECTED, { holes: next });
    this.render();
  }

  dimensionsFor(state) {
    const empty = { html: "", scoreCaption: "", safetyActive: false };
    if (!isAdvancedDev() || !state?.verdict) return empty;
    try {
      const flags = {
        golferPreferences: featureOn("golferPreferences"),
        forecastConfidence: featureOn("forecastConfidence"),
        groundConditionRisk: featureOn("groundConditionRisk"),
        safetyOverrides: featureOn("safetyOverrides"),
        courseStatus: featureOn("courseStatus"),
      };
      if (!Object.values(flags).some(Boolean)) return empty;

      let preferences = null;
      if (flags.golferPreferences) {
        try {
          preferences = loadGolferPreferences();
        } catch {
          preferences = null;
        }
      }

      let originalSnapshot = null;
      let latestSnapshot = null;
      if (flags.forecastConfidence && this.openedRoundId) {
        const pair = getRoundWeatherPair(this.openedRoundId);
        const sameCheck =
          pair?.original &&
          pair?.latest &&
          pair.original.checkedAt != null &&
          pair.original.checkedAt === pair.latest.checkedAt;
        if (pair?.original && pair?.latest && !sameCheck) {
          originalSnapshot = pair.original;
          latestSnapshot = pair.latest;
        }
      }

      const model = buildForecastDimensions({
        flags,
        verdict: state.verdict,
        preferences,
        nowUnix: Math.floor(Date.now() / 1000),
        teeTimeUnix: state.selectedTeeTime,
        windowHours: state.windowHours,
        hourly: state.hourly,
        units: state.units,
        originalSnapshot,
        latestSnapshot,
        groundSignals: flags.groundConditionRisk ? this.groundSignals : null,
        course: state.course,
        nowMs: Date.now(),
      });
      return {
        html: model.hasPanel ? renderForecastDimensions(model) : "",
        scoreCaption: model.scoreCaption,
        safetyActive: model.safetyActive,
      };
    } catch {
      return empty;
    }
  }

  forecastExtras() {
    const empty = {
      extendedOutlookHtml: "",
      radarHtml: "",
      sponsoredHtml: "",
      eveningHtml: "",
      premiumHtml: "",
    };
    if (!isAdvancedDev()) return { ...empty, premiumHtml: renderPremiumLocks() };
    if (!this.norm) return empty;
    const tier = getEntitlementTier();
    let extendedOutlookHtml = "";
    let radarHtml = "";
    let sponsoredHtml = "";
    let eveningHtml = "";
    const premiumHtml = canAccess("radar", tier) ? "" : renderPremiumLocks();

    if (featureOn("eveningPractice")) {
      eveningHtml = canAccess("eveningPractice", tier)
        ? this.eveningPracticeHtml()
        : renderSoftGate({
            title: "Evening practice",
            body: "Premium finds the best remaining window for 3, 6 or 9 holes and makes sure it finishes before last playable light.",
          });
    }

    if (featureOn("extendedOutlook")) {
      if (canAccess("extendedOutlook", tier)) {
        const outlook = buildExtendedOutlook(this.norm, {
          units: this.units,
          countryCode: this.courseService.getCountry(),
          windowHours: getRoundDurationHours(this.holes),
        });
        extendedOutlookHtml = renderExtendedOutlook(outlook);
        if (!this.outlookTracked) {
          this.outlookTracked = true;
          trackDevEvent(DevAnalyticsEvents.OUTLOOK_VIEWED, { days: outlook.days?.length || 0 });
        }
      } else {
        extendedOutlookHtml = renderSoftGate({
          title: "Extended outlook",
          body: "Extra days sit below the five-day strip on Premium preview. Scores are only shown when hourly data already exists.",
        });
      }
    }

    if (featureOn("radarFoundation")) {
      if (canAccess("radar", tier)) {
        radarHtml = renderRadarPanel(loadRadarFoundation());
        if (!this.radarTracked) {
          this.radarTracked = true;
          trackDevEvent(DevAnalyticsEvents.RADAR_PANEL_VIEWED);
        }
      } else {
        radarHtml = renderSoftGate({
          title: "Rain radar",
          body: "The radar foundation stays on mock layers. Live radar is not connected.",
        });
      }
    }

    if (featureOn("monetisationHooks")) {
      const selection = selectSponsoredPlacement({
        affiliateCards: devFeatures.affiliateCards,
        adsenseSlot: devFeatures.adsenseSlot,
        monetisationHooks: true,
        surface: "forecast",
      });
      sponsoredHtml = `${renderSponsoredGolfCard(selection)}${renderAdsenseSlot({ enabled: devFeatures.adsenseSlot })}`;
      if (!this.sponsorTracked) {
        this.sponsorTracked = true;
        trackDevEvent(DevAnalyticsEvents.SPONSORED_PLACEMENT_EVALUATED, {
          placement: selection.placement || "none",
        });
      }
    }

    return { extendedOutlookHtml, radarHtml, sponsoredHtml, eveningHtml, premiumHtml };
  }

  openMore() {
    openSheet("More", renderMoreMenu(this.moreItems()), document.getElementById("fwMoreBtn"));
    document.querySelectorAll("[data-more-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeSheet();
        const target = btn.getAttribute("data-more-tab");
        this.navigate(target === "wind" ? "caddie" : target);
      });
    });
  }

  moreItems() {
    const items = [];
    items.push({ id: "caddie", label: "Shot Caddie", hint: "Distance, wind on the shot, and a club" });
    if (featureOn("weatherAlerts")) items.push({ id: "alerts", label: "Alerts", hint: "In-app weather changes" });
    if (featureOn("societyWeather")) items.push({ id: "society", label: "Society", hint: "Score a run of tee times" });

    items.push({
      id: "settings",
      label: "Settings",
      hint: featureOn("golferPreferences") ? "Preferences, disclosure, and offline" : "Disclosure and offline",
    });
    return items;
  }

  societyCourses() {
    const map = new Map();
    const add = (course) => {
      if (!course) return;
      const key = course.id || favKey(course);
      if (key) map.set(key, course);
    };
    add(this.selectedCourse);
    this.persistence.getFavourites().forEach(add);
    this.persistence.getRecentCourses().forEach(add);
    return [...map.values()];
  }

  async scoreSociety(form) {
    if (!isAdvancedDev() || !featureOn("societyWeather")) return;
    this.societyForm = { ...this.societyForm, ...form };
    if (!canAccess("society", getEntitlementTier())) {
      this.render();
      return;
    }
    const course =
      this.societyCourses().find((item) => (item.id || favKey(item)) === form.courseId) ||
      this.resolveCourse(form.courseId);
    if (!course) {
      this.societyError = "Choose a course you have opened or saved.";
      this.societyResult = null;
      this.render();
      return;
    }

    if (!Number.isFinite(Number(course.lat)) || !Number.isFinite(Number(course.lon))) {
      this.societyError = "This course has no location, so it can't be scored.";
      this.societyResult = null;
      this.render();
      return;
    }

    this.societyLoading = true;
    this.societyError = null;
    this.render();
    try {
      let norm = this.norm;
      const sameCourse = this.selectedCourse && favKey(this.selectedCourse) === favKey(course);
      if (!norm || !sameCourse) {
        const raw = await fetchWeather(this.apiBase, course.lat, course.lon, this.units);
        norm = normalizeWeather(raw);
      }
      this.societyResult = generateSocietySlots({
        norm,
        dateKey: form.date,
        firstTee: form.firstTee,
        intervalMinutes: form.interval,
        groups: form.groups,
        playersPerGroup: form.players,
        windowHours: getRoundDurationHours(18),
        units: this.units,
        countryCode: course.country || this.courseService.getCountry(),
      });
      if (this.societyResult?.error) this.societyError = this.societyResult.error;
      trackDevEvent(DevAnalyticsEvents.SOCIETY_SCORED, { groups: Number(form.groups) || 0 });
    } catch (err) {
      this.societyError = err.message || "Could not score these tee times.";
      this.societyResult = null;
    } finally {
      this.societyLoading = false;
      this.render();
    }
  }

  saveRoundEdit(id, patch) {
    const round = this.persistence.getRound(id);
    if (!round) return;
    const next = applyRoundEdit(round, patch);
    this.persistence.updateRound(id, next);
    this.editingRoundId = null;
    this.roundSummaries.delete(id);
    trackDevEvent(DevAnalyticsEvents.ROUND_EDITED);
    this.render();
    this.loadRoundSummaries();
  }

  setTier(tier) {
    setEntitlementTier(tier);
    this.syncRoundAlerts();
    trackDevEvent(DevAnalyticsEvents.ENTITLEMENT_CHANGED, { tier });
    if (this.norm && featureOn("eveningPractice")) {
      this.ensureDaylight().finally(() => this.render());
      return;
    }
    this.render();
  }

  offlineNote() {
    if (!featureOn("pwaReadiness")) return "";
    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return `<p class="fw-offline-note" role="status">You're offline. Saved courses and rounds on this device are still available. Live weather is not stored.</p>`;
      }
    } catch {
      /* ignore */
    }
    return "";
  }

  alertsLockedHtml() {
    if (!this.alertsLocked) return "";
    return renderSoftGate({
      title: "Weather alerts",
      body: "Alerts compare a saved round with the latest check. Premium preview includes them. Delivery stays in the app.",
    });
  }

  shotAnalytics() {
    return { also: (event, props) => trackDevEvent(event, props) };
  }

  markShotCaddieVisit() {
    if (this.shotVisitOpen) return;
    this.shotVisitOpen = true;
    noteShotCaddieOpened(this.shotAnalytics());
  }

  ensureShotBag() {
    if (!this.shotBag) this.shotBag = loadShotClubs();
    if (!this.shotSetup) this.shotSetup = loadShotSetup();
    return this.shotBag;
  }

  ensureShotCompass() {
    if (this.shotCompass) return this.shotCompass;
    this.shotCompass = createShotCompass({
      onHeading: (bearing) => this.onShotCompassHeading(bearing),
      onStatus: (text) => {
        this.shotCompassStatus = text;
        this.updateShotCompassDom();
      },
    });
    return this.shotCompass;
  }

  stopShotCompass() {
    this.shotCompass?.stop();
  }

  shotConditionsOnly() {
    let rainAnalysis = null;
    if (this.norm && this.selectedTeeTime) {
      const windowHours = getRoundDurationHours(this.holes);
      rainAnalysis = analyzeRainDuringRound(
        this.norm.hourly || [],
        this.selectedTeeTime,
        windowHours,
        this.norm.timezoneOffset || 0
      );
    }
    return shotConditionsFromForecast({
      loaded: Boolean(this.norm),
      units: this.units,
      teeTimeUnix: this.selectedTeeTime,
      hourly: this.norm?.hourly || [],
      current: this.norm?.current || null,
      rainAnalysis,
    });
  }

  buildShotCompassState(conditions) {
    const state = this.shotCompass?.getState() || {};
    const shotBearing = state.shotBearing ?? null;
    let relative = null;
    let relativeArrow = null;
    let relativeLabel = null;
    if (conditions.windKnown && Number.isFinite(conditions.windDeg) && shotBearing != null) {
      relative = windRelativeToShot({
        windFrom: conditions.windDeg,
        shotBearing,
        speedMph: conditions.windMph,
      });
      relativeArrow = windArrowRelativeToShot(conditions.windDeg, shotBearing);
      relativeLabel = relative?.label || null;
    }
    const listening = Boolean(state.listening);
    return {
      available: typeof window !== "undefined" && "DeviceOrientationEvent" in window,
      listening,
      heading: state.heading ?? null,
      locked: Boolean(state.locked),
      shotBearing,
      relativeArrow,
      relativeLabel,
      compassActive: shotBearing != null && conditions.windKnown,
      manualWind: this.shotWindManual,
      status: this.shotCompassStatus,
    };
  }

  applyCompassWindSegment(conditions, shotBearing) {
    if (!conditions.windKnown || !Number.isFinite(conditions.windDeg) || shotBearing == null) return;
    const relative = windRelativeToShot({
      windFrom: conditions.windDeg,
      shotBearing,
      speedMph: conditions.windMph,
    });
    const segment = classifyWindOnShot(relative);
    if (!segment) return;
    this.ensureShotBag();
    if (this.shotSetup.windOnShot === segment) return;
    this.shotSetup = { ...this.shotSetup, windOnShot: segment };
    saveShotSetup(this.shotSetup);
    this.shotRecSig = "";
  }

  onShotCompassHeading() {
    if (this.activeTab !== "caddie") return;
    const conditions = this.shotConditionsOnly();
    const shotBearing = this.shotCompass?.shotBearing();
    if (!this.shotWindManual && shotBearing != null) {
      this.applyCompassWindSegment(conditions, shotBearing);
    }
    this.updateShotCompassDom();
  }

  updateShotCompassDom() {
    if (this.activeTab !== "caddie" || (this.shotPanel || "shot") !== "shot") return;
    const conditions = this.shotConditionsOnly();
    const compass = this.buildShotCompassState(conditions);
    const bag = this.ensureShotBag();
    const units = bag.units === "m" ? "m" : "yd";
    const windOnShot = this.shotSetup.windOnShot;

    const line = document.getElementById("fwShotWindLine");
    if (line) line.textContent = formatWindLine(conditions, compass);

    const status = document.getElementById("fwShotCompassStatus");
    if (status) status.textContent = compass.status || "";

    document.querySelectorAll("[data-shot-wind]").forEach((btn) => {
      const value = btn.getAttribute("data-shot-wind");
      const active = value === windOnShot;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });

    const lockBtn = document.getElementById("fwShotCompassLock");
    if (lockBtn) {
      lockBtn.textContent = compass.locked ? "Unlock" : "Lock aim";
      lockBtn.disabled = compass.heading == null && !compass.locked;
    }
    const startBtn = document.getElementById("fwShotCompassStart");
    if (startBtn) startBtn.textContent = compass.listening ? "Compass on" : "Use compass";

    const rec = recommendShot({
      target: this.shotTarget || "",
      units,
      windOnShot,
      windMph: conditions.windKnown ? conditions.windMph : null,
      rain: conditions.rainKey,
      ground: this.shotSetup.ground,
      clubs: bag.clubs,
    });
    const slot = document.getElementById("fwShotResult");
    if (slot) slot.innerHTML = renderShotResult(rec, units);
    this.maybeTrackShotRecommendation(rec);
  }

  async onShotCompassStart() {
    this.ensureShotCompass();
    this.shotWindManual = false;
    const ok = await this.shotCompass.start();
    if (ok) {
      const conditions = this.shotConditionsOnly();
      const bearing = this.shotCompass.shotBearing();
      if (bearing != null) this.applyCompassWindSegment(conditions, bearing);
    }
    this.render();
  }

  onShotCompassLock() {
    this.ensureShotCompass();
    const locked = this.shotCompass.getState().locked;
    if (locked) {
      this.shotCompass.unlock();
      this.shotWindManual = false;
    } else if (this.shotCompass.lock()) {
      this.shotWindManual = false;
      const conditions = this.shotConditionsOnly();
      this.applyCompassWindSegment(conditions, this.shotCompass.shotBearing());
    }
    this.render();
  }

  maybeShotGeolocation() {
    if (this.shotGpsRequested || typeof navigator === "undefined" || !navigator.geolocation) return;
    this.shotGpsRequested = true;
    navigator.geolocation.getCurrentPosition(
      () => {},
      () => {},
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  getShotState() {
    const bag = this.ensureShotBag();
    const conditions = this.shotConditionsOnly();
    return {
      panel: this.shotPanel || "shot",
      hasWeather: Boolean(this.norm),
      loading: Boolean(this.weatherLoading && !this.norm),
      conditions,
      target: this.shotTarget || "",
      units: bag.units === "m" ? "m" : "yd",
      windOnShot: this.shotSetup.windOnShot,
      ground: this.shotSetup.ground,
      clubs: bag.clubs,
      compass: this.buildShotCompassState(conditions),
    };
  }

  shotRecommendation() {
    const state = this.getShotState();
    return recommendShot({
      target: state.target,
      units: state.units,
      windOnShot: state.windOnShot,
      windMph: state.conditions.windKnown ? state.conditions.windMph : null,
      rain: state.conditions.rainKey,
      ground: state.ground,
      clubs: state.clubs,
    });
  }

  maybeTrackShotRecommendation(rec) {
    if (!rec || rec.state !== "ready") return;
    const sig = [rec.playsLikeYards, rec.club?.id, rec.clubSteps, this.shotSetup?.windOnShot, this.shotSetup?.ground, rec.rainYards].join("|");
    if (sig === this.shotRecSig) return;
    this.shotRecSig = sig;
    trackShotCaddieEvent(ShotCaddieEvents.RECOMMENDATION_GENERATED, { club: rec.club?.name }, this.shotAnalytics());
  }

  onShotDistance(value) {
    this.shotTarget = String(value ?? "");
    const rec = this.shotRecommendation();
    const slot = document.getElementById("fwShotResult");
    if (slot) slot.innerHTML = renderShotResult(rec, this.ensureShotBag().units === "m" ? "m" : "yd");
    const yards = Number(this.shotTarget);
    if (this.shotTarget !== "" && Number.isFinite(yards) && yards >= 1 && this.shotTarget !== this.shotDistanceTracked) {
      this.shotDistanceTracked = this.shotTarget;
      trackShotCaddieEvent(ShotCaddieEvents.DISTANCE_ENTERED, {}, this.shotAnalytics());
    }
    this.maybeTrackShotRecommendation(rec);
  }

  onShotUnits(units) {
    const bag = this.ensureShotBag();
    this.shotBag = setShotClubUnits(bag, units);
    saveShotClubs(this.shotBag);
    this.shotRecSig = "";
    this.render();
  }

  onShotWind(wind) {
    this.ensureShotBag();
    this.shotWindManual = true;
    this.shotSetup = { ...this.shotSetup, windOnShot: wind };
    saveShotSetup(this.shotSetup);
    this.render();
  }

  onShotGround(ground) {
    this.ensureShotBag();
    this.shotSetup = { ...this.shotSetup, ground };
    saveShotSetup(this.shotSetup);
    this.render();
  }

  onShotClubCarry(id, value) {
    const bag = this.ensureShotBag();
    const next = setShotClubCarry(bag, id, value);
    if (!next) return;
    this.shotBag = next;
    saveShotClubs(this.shotBag);
    this.shotRecSig = "";
  }

  render() {
    mountCourseHeader(document.getElementById("fwCourseHeaderMount"), this.selectedCourse, {
      onChange: () => this.navigate("courses"),
      isFavourite: this.persistence.isFavourite(this.selectedCourse),
      onToggleFavourite: (course) => this.toggleFavourite(course),
      onShare: () => this.onShareCourse(),
      showFavourite: featureOn("favouriteCourses"),
      showMore: true,
      onMore: () => this.openMore(),
    });

    const main = document.getElementById("fwMain");
    if (!main) return;

    if (this.activeTab === "home") {
      const coursesHtml = this.selectedCourse ? "" : renderCoursesView(this.coursesViewProps());
      main.innerHTML = renderHomeView({ ...this.getHomeState(), coursesHtml });
      wireHomeView(main, {
        onNavigate: (tab) => this.navigate(tab),
        onSelectCourse: (id) => this.selectCourse(id, { source: "home" }),
        onGoForecast: () => this.navigate("forecast"),
        onOpenBestWeek: () => this.openBestWeek(),
        onNearby: () => this.findNearbyCourses(),
        onToggleFavourite: (id) => this.toggleFavourite(id),
        onShare: () => this.onShareCourse(),
        onPremium: (id) => this.openPremium(id),
      });
      if (!this.selectedCourse) this.wireCourses(main);
    } else if (this.activeTab === "courses") {
      main.innerHTML = renderCoursesView(this.coursesViewProps());
      this.wireCourses(main);
    } else if (this.activeTab === "forecast") {
      const state = this.getForecastState();
      const extras = this.forecastExtras();
      const dimensions = this.dimensionsFor(state);
      state.dimensionsHtml = state.weatherLoading && !state.verdict ? "" : dimensions.html;
      state.scoreCaption = dimensions.scoreCaption;
      state.safetyActive = dimensions.safetyActive;
      state.showSaveRound = featureOn("savedRounds");
      state.roundLimitNote = this.roundLimitNote;
      state.extendedOutlookHtml = extras.extendedOutlookHtml;
      state.radarHtml = extras.radarHtml;
      state.sponsoredHtml = extras.sponsoredHtml;
      state.eveningHtml = state.weatherLoading && !state.verdict ? "" : extras.eveningHtml;
      state.premiumHtml = extras.premiumHtml;
      main.innerHTML = renderForecastView(state);
      wireForecastView(main, {
        onNavigate: (tab) => this.navigate(tab),
        onRetry: () => this.loadWeather(),
        onDaySelect: (key) => this.onDaySelect(key),
        onTeeTimeChange: (t) => this.onTeeTimeChange(t),
        onHolesChange: (h) => this.onHolesChange(h),
        onPracticeHoles: (h) => this.onPracticeHoles(h),
        onUseBetterTee: (t) => this.onUseBetterTee(t),
        onSaveRound: () => this.saveCurrentRound(),
        onToggleFavourite: () => this.toggleFavourite(this.selectedCourse),
        onWhyScore: () => track(AnalyticsEvents.WHY_SCORE_OPENED),
        onHourlyExpand: () => {
          this.hourlyExpanded = true;
          track(AnalyticsEvents.HOURLY_EXPANDED);
        },
        onPremium: (id) => this.openPremium(id),
        onPlanShot: () => this.navigate("caddie"),
        getScore: () => state.verdict?.score,
        getFactors: () => state.verdict?.factors,
        getDecision: () => state.decision,
        getVerdict: () => state.verdict,
        getBetterTee: () => state.betterTee,
      });
      wireSoftGate(main, () => this.navigate("account"));
    } else if (this.activeTab === "rounds") {
      const savedOn = featureOn("savedRounds");
      main.innerHTML = renderRoundsView({
        upcoming: savedOn ? this.persistence.getUpcomingRounds() : [],
        past: savedOn ? this.persistence.getPastRounds() : [],
        summaries: this.roundSummaries,
        loading: this.roundLoading,
        units: this.units,
        alerts: this.roundAlerts,
        alertHtml: this.alertsLockedHtml(),
        historyByRound: this.historyByRound(),
        editingId: this.editingRoundId,
        showExtended: isAdvancedDev() && savedOn,
        disabled: isAdvancedDev() && !savedOn,
      });
      wireRoundsView(main, {
        onOpen: (id) => this.openRound(id),
        onDelete: (id) => this.deleteRound(id),
        onPlayAgain: (id) => this.playAgain(id),
        onEdit: (id) => {
          this.editingRoundId = id;
          this.render();
        },
        onCancelEdit: () => {
          this.editingRoundId = null;
          this.render();
        },
        onSaveEdit: (id, patch) => this.saveRoundEdit(id, patch),
        onDismissAlert: (fingerprint) => this.dismissAlert(fingerprint),
      });
      wireSoftGate(main, () => this.navigate("account"));
    } else if (this.activeTab === "caddie") {
      const shotState = this.getShotState();
      main.innerHTML = renderShotCaddieView(shotState);
      wireShotCaddieView(main, {
        onForecast: () => this.navigate(this.selectedCourse ? "forecast" : "courses"),
        onBack: () => {
          this.shotPanel = "shot";
          this.render();
        },
        onClubs: () => {
          this.shotPanel = "clubs";
          this.render();
        },
        onDistance: (value) => this.onShotDistance(value),
        onUnits: (units) => this.onShotUnits(units),
        onWind: (wind) => this.onShotWind(wind),
        onGround: (ground) => this.onShotGround(ground),
        onClubCarry: (id, value) => this.onShotClubCarry(id, value),
        onCompassStart: () => this.onShotCompassStart(),
        onCompassLock: () => this.onShotCompassLock(),
      });
      if (shotState.panel === "shot" && shotState.hasWeather) {
        this.ensureShotCompass();
        if (!this.shotCompassStarted) {
          this.shotCompassStarted = true;
          void this.shotCompass.start().then((ok) => {
            if (ok && this.activeTab === "caddie") {
              const conditions = this.shotConditionsOnly();
              const bearing = this.shotCompass.shotBearing();
              if (bearing != null && !this.shotWindManual) {
                this.applyCompassWindSegment(conditions, bearing);
              }
              this.updateShotCompassDom();
            }
          });
        }
        this.maybeShotGeolocation();
        const testHeading = new URLSearchParams(location.search).get("shotHeading");
        if (testHeading != null && Number.isFinite(Number(testHeading))) {
          this.shotCompass.setHeadingForTest(Number(testHeading));
          if (!this.shotWindManual) {
            this.applyCompassWindSegment(this.shotConditionsOnly(), this.shotCompass.shotBearing());
          }
          this.updateShotCompassDom();
        }
        this.maybeTrackShotRecommendation(this.shotRecommendation());
      }
    } else if (this.activeTab === "alerts") {
      main.innerHTML = renderAlertsView({
        alerts: this.roundAlerts,
        lockedHtml: !featureOn("weatherAlerts")
          ? `<p class="fw-muted">Weather alerts are turned off in this preview.</p>`
          : this.alertsLockedHtml(),
      });
      wireAlerts(main, { onDismiss: (fingerprint) => this.dismissAlert(fingerprint) });
      wireSoftGate(main, () => this.navigate("account"));
    } else if (this.activeTab === "society") {
      const locked =
        featureOn("societyWeather") && !canAccess("society", getEntitlementTier())
          ? renderSoftGate({
              title: "Society weather",
              body: "Score a run of tee times on Premium preview. The page stays on this device.",
            })
          : "";
      const off = !featureOn("societyWeather");
      main.innerHTML = off
        ? `<div class="fw-view"><h1 class="fw-page-title">Society</h1><p class="fw-muted">Society weather is currently unavailable.</p></div>`
        : renderSocietyView({
            courses: this.societyCourses(),
            form: { ...this.societyForm, courseId: this.societyForm.courseId || this.selectedCourse?.id || "" },
            result: this.societyResult,
            error: this.societyError,
            loading: this.societyLoading,
            lockedHtml: locked,
          });
      wireSocietyView(main, { onScore: (form) => this.scoreSociety(form) });
      wireSoftGate(main, () => this.navigate("account"));
    } else if (this.activeTab === "account") {
      main.innerHTML = featureOn("premiumShell")
        ? renderAccountView({ tier: getEntitlementTier() })
        : `<div class="fw-view"><h1 class="fw-page-title">Account</h1><p class="fw-muted">Account preview is turned off.</p></div>`;
      wireAccountView(main, { onTier: (tier) => this.setTier(tier) });
    } else if (this.activeTab === "settings") {
      const showPreferences = featureOn("golferPreferences");
      let preferences = null;
      if (showPreferences) {
        try {
          preferences = loadGolferPreferences();
        } catch {
          preferences = null;
        }
      }
      main.innerHTML = renderSettingsView({
        notificationMode: this.notifications.mode,
        showPreferences,
        preferences,
      });
      wireSettingsView(main, {
        onPreferencesChange: (prefs) => {
          try {
            return saveGolferPreferences(prefs);
          } catch {
            return false;
          }
        },
      });
    }

    const note = this.offlineNote();
    if (note) main.insertAdjacentHTML("afterbegin", note);
    setActiveTab(this.activeTab);

    if (typeof lucide !== "undefined") lucide.createIcons();
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new FairwayApp();
  app.init();
});
