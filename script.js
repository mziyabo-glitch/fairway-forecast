(() => {
  const cfg = window.APP_CONFIG;
  const $ = id => document.getElementById(id);

  const els = {
    txtSearch: $("txtSearch"),
    btnSearch: $("btnSearch"),
    btnGeo: $("btnGeo"),
    ddlUnits: $("ddlUnits"),
    ddlCourses: $("ddlCourses"),
    txtCourseFilter: $("txtCourseFilter"),
    ddlFavs: $("ddlFavs"),
    btnFavToggle: $("btnFavToggle"),
    dvCityCountry: $("dvCityCountry"),
    dvCurrDate: $("dvCurrDate"),
    dvCurrTemp: $("dvCurrTemp"),
    pFeelsLike: $("pFeelsLike"),
    pHumidity: $("pHumidity"),
    pWind: $("pWind"),
    imgIcon: $("imgCurrentIcon"),
    playScore: $("playScore"),
    playText: $("playText"),
    pSunrise: $("pSunrise"),
    pSunset: $("pSunset"),
    pDayLength: $("pDayLength"),
    bestTeeTime: $("bestTeeTime"),
    bestTeeScore: $("bestTeeScore"),
    bestTeeReason: $("bestTeeReason"),
    dailyForecast: $("dailyForecast"),
    hourlyHours: $("hourlyHours"),
    ddlDay: $("ddlDay"),
    appStatus: $("appStatus"),
    coursesStatus: $("coursesStatus")
  };

  const supabase = supabasejs.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY
  );

  let units = "metric";
  let dayBuckets = [];

  function icon(code){
    return `https://openweathermap.org/img/wn/${code}@2x.png`;
  }

  function playability(it){
    let score = 10;
    let reasons = [];

    if(it.wind.speed > 10){ score -= 3; reasons.push("Windy"); }
    if(it.pop > 0.4){ score -= 2; reasons.push("Rain risk"); }
    if(it.main.temp < 5){ score -= 1.5; reasons.push("Cold"); }

    score = Math.max(0,Math.round(score*10)/10);

    return {
      score,
      label: score >= 8 ? "Excellent" : score >=6 ? "Good" : "Fair",
      reason: reasons.join(" • ") || "Ideal conditions"
    };
  }

  function bestTeeTimeToday(bucket){
    let best = null;

    bucket.items.forEach(it=>{
      const p = playability(it);
      if(!best || p.score > best.p.score){
        best = { it, p };
      }
    });

    if(!best) return;

    const dt = best.it._dt;
    const end = new Date(dt.getTime()+3*60*60*1000);

    els.bestTeeTime.textContent =
      `${dt.getHours()}:00 – ${end.getHours()}:00`;
    els.bestTeeScore.textContent =
      `${best.p.score}/10 (${best.p.label})`;
    els.bestTeeReason.textContent = best.p.reason;
  }

  async function loadWeather(lat,lon,name,country){
    els.appStatus.textContent = "Loading weather…";

    const res = await fetch(
      `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${cfg.OPENWEATHER_API_KEY}`
    );
    const data = await res.json();

    els.dvCityCountry.textContent = `${name}, ${country}`;
    els.dvCurrTemp.textContent = Math.round(data.list[0].main.temp);
    els.pFeelsLike.textContent = Math.round(data.list[0].main.feels_like);
    els.pHumidity.textContent = data.list[0].main.humidity;
    els.pWind.textContent = `${Math.round(data.list[0].wind.speed)} m/s`;
    els.imgIcon.src = icon(data.list[0].weather[0].icon);

    const sunrise = data.city.sunrise;
    const sunset = data.city.sunset;
    els.pSunrise.textContent = new Date(sunrise*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    els.pSunset.textContent = new Date(sunset*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    els.pDayLength.textContent =
      `Day length: ${Math.floor((sunset-sunrise)/3600)}h`;

    dayBuckets = {};
    data.list.forEach(it=>{
      const d = new Date(it.dt*1000);
      const key = d.toISOString().slice(0,10);
      if(!dayBuckets[key]) dayBuckets[key]=[];
      dayBuckets[key].push({...it,_dt:d});
    });

    const todayKey = Object.keys(dayBuckets)[0];
    bestTeeTimeToday({ items: dayBuckets[todayKey] });

    els.appStatus.textContent = "";
  }

  async function loadCourses(){
    const {data} = await supabase
      .from("uk_golf_courses")
      .select("*")
      .order("name");

    els.ddlCourses.innerHTML = "<option>Select course</option>";
    data.forEach(c=>{
      const o = document.createElement("option");
      o.textContent = c.name;
      o.dataset.lat = c.latitude;
      o.dataset.lon = c.longitude;
      o.dataset.country = c.country;
      els.ddlCourses.appendChild(o);
    });

    els.coursesStatus.textContent = `${data.length} courses loaded`;
  }

  els.ddlCourses.onchange = e=>{
    const o = e.target.selectedOptions[0];
    loadWeather(o.dataset.lat,o.dataset.lon,o.textContent,o.dataset.country);
  };

  els.btnSearch.onclick = async ()=>{
    const q = els.txtSearch.value;
    const r = await fetch(
      `https://api.openweathermap.org/geo/1.0/direct?q=${q}&limit=1&appid=${cfg.OPENWEATHER_API_KEY}`
    );
    const g = (await r.json())[0];
    loadWeather(g.lat,g.lon,g.name,g.country);
  };

  els.btnGeo.onclick = ()=>{
    navigator.geolocation.getCurrentPosition(p=>{
      loadWeather(
        p.coords.latitude,
        p.coords.longitude,
        "My location",
        ""
      );
    });
  };

  loadCourses();
  loadWeather(51.5072,-0.1276,"London","GB");
})();
