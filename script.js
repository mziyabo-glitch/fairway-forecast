(() => {
  const cfg = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const ddlCourses = $("ddlCourses");
  const statusEl = $("appStatus");

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || "";
  }

  // Supabase client
  const supabase = window.supabase.createClient(
    cfg.SUPABASE_URL,
    cfg.SUPABASE_ANON_KEY
  );

  // Load courses from YOUR table
  async function loadCourses() {
    setStatus("Loading courses from Supabase...");
    ddlCourses.innerHTML = `<option value="">Courses (loading...)</option>`;

    const { data, error } = await supabase
      .from("uk_golf_courses")   // ✅ correct table
      .select("name, country, latitude, longitude")
      .order("name", { ascending: true });

    if (error) {
      console.error(error);
      setStatus("Supabase error: " + error.message);
      ddlCourses.innerHTML = `<option value="">Courses (error)</option>`;
      return;
    }

    if (!data || data.length === 0) {
      setStatus("No courses found in uk_golf_courses.");
      ddlCourses.innerHTML = `<option value="">No courses found</option>`;
      return;
    }

    ddlCourses.innerHTML = `<option value="">Select a course...</option>`;

    data.forEach(c => {
      const opt = document.createElement("option");
      opt.textContent = `${c.name} (${c.country})`;
      opt.dataset.lat = c.latitude;    // ✅ map correctly
      opt.dataset.lon = c.longitude;   // ✅ map correctly
      opt.dataset.name = c.name;
      opt.dataset.country = c.country;
      ddlCourses.appendChild(opt);
    });

    setStatus("");
  }

  // When course selected → load weather
  ddlCourses.addEventListener("change", () => {
    const opt = ddlCourses.selectedOptions[0];
    if (!opt || !opt.dataset.lat) return;

    // reuse existing weather function if present
    if (window.showForecastForPlace) {
      window.showForecastForPlace({
        name: opt.dataset.name,
        country: opt.dataset.country,
        lat: Number(opt.dataset.lat),
        lon: Number(opt.dataset.lon)
      });
    }
  });

  loadCourses();
})();
