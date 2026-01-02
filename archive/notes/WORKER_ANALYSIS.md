# Worker Code Analysis - Available Fields from GolfCourseAPI

## Current Worker Implementation

Looking at `worker-complete.js` lines 121-134, the worker currently extracts:

```javascript
const normalized = courses.map((c) => {
  const loc = c.location || {};
  return {
    id: c.id,
    name: c.course_name || c.club_name || `Course ${c.id}`,
    club_name: c.club_name || "",
    course_name: c.course_name || "",
    city: loc.city || "",
    state: loc.state || "",
    country: loc.country || "",
    lat: typeof loc.latitude === "number" ? loc.latitude : null,
    lon: typeof loc.longitude === "number" ? loc.longitude : null,
  };
});
```

## Available Fields from GolfCourseAPI (Not Currently Exposed)

Based on typical GolfCourseAPI v1 search responses, the following fields are likely available but not currently exposed:

### Top-Level Course Fields:
- `c.id` ✅ (currently used)
- `c.course_name` ✅ (currently used)
- `c.club_name` ✅ (currently used)
- `c.description` - Course description
- `c.par` - Course par (e.g., 72)
- `c.yardage` - Total yardage
- `c.rating` - Course rating
- `c.slope` - Slope rating
- `c.holes` - Number of holes (18, 9, etc.)
- `c.type` - Course type (public, private, semi-private)
- `c.year_opened` - Year opened
- `c.style` - Course style (links, parkland, desert, etc.)
- `c.designer` - Course designer name
- `c.architect` - Course architect
- `c.established` - Year established
- `c.images` - Array of image URLs
- `c.logo` - Club logo URL
- `c.amenities` - Array of amenities
- `c.facilities` - Additional facilities
- `c.tees` - Array of tee box information
- `c.green_fees` - Green fee information
- `c.booking_url` - Booking/tee time URL
- `c.website` - Website URL
- `c.reviews` - Reviews/ratings
- `c.rating` - Average rating
- `c.review_count` - Number of reviews

### Location Object Fields (`c.location`):
- `loc.city` ✅ (currently used)
- `loc.state` ✅ (currently used)
- `loc.country` ✅ (currently used)
- `loc.latitude` ✅ (currently used)
- `loc.longitude` ✅ (currently used)
- `loc.address` - Full street address
- `loc.postal_code` - Postal/ZIP code
- `loc.phone` - Phone number
- `loc.email` - Email address
- `loc.website` - Website URL
- `loc.timezone` - Timezone
- `loc.elevation` - Elevation above sea level

### Tee Information (`c.tees` array):
Each tee object typically contains:
- `name` - Tee name (Championship, Men's, Women's, etc.)
- `yardage` - Yardage for this tee
- `par` - Par for this tee
- `rating` - Rating for this tee
- `slope` - Slope for this tee

## Recommended Fields to Add

### High Priority (Most Useful):
1. **Contact Information:**
   - `address` - Full address
   - `phone` - Phone number
   - `website` - Website URL
   - `email` - Email address

2. **Course Details:**
   - `par` - Course par
   - `yardage` - Total yardage
   - `holes` - Number of holes
   - `type` - Course type (public/private)
   - `description` - Course description

3. **Media:**
   - `images` - Course images
   - `logo` - Club logo

### Medium Priority:
- `rating` - Course rating
- `slope` - Slope rating
- `amenities` - Amenities list
- `style` - Course style
- `designer` - Course designer

### Low Priority:
- `tees` - Detailed tee information
- `green_fees` - Pricing
- `reviews` - Reviews/ratings
- `year_opened` - Year opened

## How to Update the Worker

To expose additional fields, modify the `normalized` mapping in `handleCourses` function:

```javascript
const normalized = courses.map((c) => {
  const loc = c.location || {};
  return {
    // Current fields
    id: c.id,
    name: c.course_name || c.club_name || `Course ${c.id}`,
    club_name: c.club_name || "",
    course_name: c.course_name || "",
    city: loc.city || "",
    state: loc.state || "",
    country: loc.country || "",
    lat: typeof loc.latitude === "number" ? loc.latitude : null,
    lon: typeof loc.longitude === "number" ? loc.longitude : null,
    
    // ADD NEW FIELDS HERE:
    address: loc.address || "",
    phone: loc.phone || "",
    website: loc.website || c.website || "",
    email: loc.email || "",
    postal_code: loc.postal_code || "",
    
    par: typeof c.par === "number" ? c.par : null,
    yardage: typeof c.yardage === "number" ? c.yardage : null,
    rating: typeof c.rating === "number" ? c.rating : null,
    slope: typeof c.slope === "number" ? c.slope : null,
    holes: typeof c.holes === "number" ? c.holes : null,
    type: c.type || "",
    description: c.description || "",
    
    images: Array.isArray(c.images) ? c.images : [],
    logo: c.logo || "",
    amenities: Array.isArray(c.amenities) ? c.amenities : [],
    style: c.style || "",
    designer: c.designer || "",
    
    // Optional: include tees if needed (can be large)
    // tees: Array.isArray(c.tees) ? c.tees : [],
  };
});
```

## Next Steps

1. **Test the API** - Make a real API call to see what fields are actually returned
2. **Update worker** - Add desired fields to the normalized response
3. **Update app.js** - Modify `normalizeCourse()` to handle new fields
4. **Update UI** - Display new information in course cards/details
