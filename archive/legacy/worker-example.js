/**
 * Cloudflare Worker Example - Fairway Forecast API
 * 
 * This is an example of what your worker code might look like.
 * The actual worker is deployed separately at: https://fairway-forecast-api.mziyabo.workers.dev
 * 
 * GolfCourseAPI typically provides these fields (check their docs for exact structure):
 */

// Example worker structure
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Courses endpoint
    if (path.startsWith('/courses')) {
      const search = url.searchParams.get('search');
      
      // Call GolfCourseAPI
      const golfApiResponse = await fetch(
        `https://api.golfcourseapi.com/courses?search=${encodeURIComponent(search)}`,
        {
          headers: {
            'X-API-KEY': env.GOLF_COURSE_API_KEY
          }
        }
      );
      
      const golfData = await golfApiResponse.json();
      
      // Currently your worker only returns these fields:
      const courses = golfData.courses?.map(course => ({
        id: course.id,
        name: course.name,
        club_name: course.club_name,
        course_name: course.course_name,
        city: course.city,
        state: course.state,
        country: course.country,
        lat: course.lat,
        lon: course.lon
      })) || [];
      
      // GolfCourseAPI typically also provides:
      // - course.address (full address)
      // - course.phone (phone number)
      // - course.website (website URL)
      // - course.email (email address)
      // - course.postal_code (postal/ZIP code)
      // - course.par (course par)
      // - course.yardage (total yardage)
      // - course.rating (course rating)
      // - course.slope (slope rating)
      // - course.holes (number of holes)
      // - course.type (public/private/semi-private)
      // - course.description (course description)
      // - course.images (array of image URLs)
      // - course.amenities (array of amenities)
      // - course.designer (course designer name)
      // - course.year_opened (year opened)
      // - course.style (links, parkland, etc.)
      // - course.tees (array of tee box information)
      // - course.reviews (reviews/ratings)
      // - course.green_fees (pricing information)
      
      return new Response(JSON.stringify({ ok: true, courses }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Weather endpoint
    if (path.startsWith('/weather')) {
      const lat = url.searchParams.get('lat');
      const lon = url.searchParams.get('lon');
      const units = url.searchParams.get('units') || 'metric';
      
      const weatherResponse = await fetch(
        `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${env.OPENWEATHER_API_KEY}`
      );
      
      const weatherData = await weatherResponse.json();
      return new Response(JSON.stringify(weatherData), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Geocode endpoint
    if (path.startsWith('/geocode')) {
      const q = url.searchParams.get('q');
      const limit = url.searchParams.get('limit') || '1';
      
      const geoResponse = await fetch(
        `http://api.openweathermap.org/geo/1.0/direct?q=${encodeURIComponent(q)}&limit=${limit}&appid=${env.OPENWEATHER_API_KEY}`
      );
      
      const geoData = await geoResponse.json();
      return new Response(JSON.stringify(geoData), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Root endpoint
    return new Response(JSON.stringify({
      ok: true,
      service: 'fairway-forecast-api',
      hasOpenWeatherKey: !!env.OPENWEATHER_API_KEY,
      hasGolfCourseKey: !!env.GOLF_COURSE_API_KEY,
      time: new Date().toISOString()
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
