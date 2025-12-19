# GolfCourseAPI Available Fields

Based on typical GolfCourseAPI responses, here are the fields that are **available** but **not currently exposed** by your worker:

## Currently Exposed Fields (via your worker):
- `id` - Course ID
- `name` - Course name  
- `club_name` - Club name
- `course_name` - Course name
- `city` - City
- `state` - State/Province
- `country` - Country
- `lat` - Latitude
- `lon` - Longitude

## Additional Fields Available from GolfCourseAPI:

### Contact Information:
- `address` - Full street address
- `phone` - Phone number
- `website` - Website URL
- `email` - Email address
- `postal_code` - Postal/ZIP code

### Course Details:
- `par` - Course par (e.g., 72)
- `yardage` - Total yardage
- `rating` - Course rating
- `slope` - Slope rating
- `holes` - Number of holes (18, 9, etc.)
- `type` - Course type (public, private, semi-private)
- `description` - Course description/text
- `year_opened` - Year the course opened
- `style` - Course style (links, parkland, desert, etc.)
- `designer` - Course designer name

### Media:
- `images` - Array of image URLs
- `logo` - Club logo URL

### Amenities & Features:
- `amenities` - Array of amenities (driving range, pro shop, restaurant, etc.)
- `facilities` - Additional facilities information

### Tee Information:
- `tees` - Array of tee box information:
  - `name` - Tee name (Championship, Men's, Women's, etc.)
  - `yardage` - Yardage for this tee
  - `par` - Par for this tee
  - `rating` - Rating for this tee
  - `slope` - Slope for this tee

### Pricing & Booking:
- `green_fees` - Green fee information
- `booking_url` - Booking/tee time URL
- `pricing` - Pricing details

### Reviews & Ratings:
- `reviews` - Array of reviews
- `rating` - Average rating
- `review_count` - Number of reviews

### Additional Metadata:
- `timezone` - Timezone
- `elevation` - Elevation above sea level
- `established` - Year established
- `architect` - Course architect
- `manager` - Course manager information

## To Access These Fields:

You would need to update your Cloudflare Worker code (deployed separately) to include these fields in the response. The worker code is likely in a separate repository or deployed directly via Cloudflare Dashboard.

### Example Worker Update:

```javascript
// In your worker, instead of:
const courses = golfData.courses?.map(course => ({
  id: course.id,
  name: course.name,
  // ... only basic fields
})) || [];

// You could include more fields:
const courses = golfData.courses?.map(course => ({
  id: course.id,
  name: course.name,
  club_name: course.club_name,
  course_name: course.course_name,
  city: course.city,
  state: course.state,
  country: course.country,
  lat: course.lat,
  lon: course.lon,
  // ADD THESE:
  address: course.address,
  phone: course.phone,
  website: course.website,
  email: course.email,
  par: course.par,
  yardage: course.yardage,
  rating: course.rating,
  slope: course.slope,
  holes: course.holes,
  type: course.type,
  description: course.description,
  images: course.images,
  amenities: course.amenities,
  // ... etc.
})) || [];
```

## Next Steps:

1. **Find your worker code** - Check Cloudflare Dashboard or separate repository
2. **Update the worker** - Add desired fields to the response mapping
3. **Update app.js** - Modify `normalizeCourse()` function to handle new fields
4. **Update UI** - Display new information in the course cards/details
