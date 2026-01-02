# Promotion Checklist: DEV → Production

This document explains exactly how to promote the expanded golf course coverage from `/dev` to production once testing is approved.

---

## Pre-Promotion Verification

Before promoting to production, verify the following in DEV:

### 1. Functional Testing
- [ ] DEV site loads without JavaScript errors (check browser console)
- [ ] Country selector shows all 35 countries with flags
- [ ] UK loads and search works (e.g., "St Andrews", "Wentworth")
- [ ] Ireland search returns results
- [ ] USA flow works: select state → search courses
- [ ] Germany/France/Spain/Portugal search works
- [ ] Zimbabwe returns results (even if limited)
- [ ] Selecting a course triggers weather forecast correctly
- [ ] Weather data displays in Current/Hourly/Daily tabs
- [ ] Tee time decision strip updates appropriately

### 2. Visual Verification
- [ ] DEV banner displays: "DEV ENVIRONMENT – TESTING ONLY"
- [ ] OpenStreetMap attribution visible in footer
- [ ] OpenStreetMap attribution visible near country selector
- [ ] Mobile responsiveness is correct
- [ ] No CSS layout issues

### 3. Data Verification
- [ ] All required country JSON files exist in `/data/courses/`
- [ ] JSON files contain valid course data (spot check a few)
- [ ] US state index (`us_index.json`) is populated

---

## Promotion Steps

### Step 1: Ensure Datasets are Generated

Run the build script or trigger the GitHub Action to generate all country datasets:

```bash
# Option A: Run locally
python scripts/build_courses.py

# Option B: Trigger GitHub Action manually
# Go to Actions → "Build Golf Course Datasets" → "Run workflow"
```

**Note**: The build script needs to be updated to include all new countries (IE, CA, NZ, ES, PT, NL, BE, IT, CH, AT, DK, NO, FI, CZ, PL, GR, AE, TR, JP, KR, MX, TH, MY, SG, IN, CN, ZW, MA).

### Step 2: Copy Files to Production Root

```bash
# From the repository root:

# Backup production files first
cp index.html index.html.bak
cp app.js app.js.bak
cp config.js config.js.bak
cp styles.css styles.css.bak

# Copy DEV files to production
cp dev/app.js app.js
cp dev/config.js config.js
cp dev/styles.css styles.css
cp dev/index.html index.html
```

### Step 3: Update Production `index.html`

Edit `index.html` to:

1. **Remove DEV banner** - Delete the entire DEV banner div:
   ```html
   <!-- DELETE THIS SECTION -->
   <div class="ff-dev-banner">
     ⚠️ DEV ENVIRONMENT – TESTING ONLY — <a href="/">Go to Production</a>
   </div>
   ```

2. **Remove DEV banner CSS** - Delete or comment out the inline `<style>` block for `.ff-dev-banner`

3. **Update asset paths** - Change relative paths from `../` to `./`:
   ```html
   <!-- Change from -->
   <link rel="manifest" href="../manifest.json" />
   <link rel="icon" href="../icons/favicon.ico" />
   <link rel="apple-touch-icon" href="../icons/icon-192.png" />
   <img src="../icons/icon-192.png" alt="..." />
   
   <!-- To -->
   <link rel="manifest" href="./manifest.json" />
   <link rel="icon" href="./icons/favicon.ico" />
   <link rel="apple-touch-icon" href="./icons/icon-192.png" />
   <img src="./icons/icon-192.png" alt="..." />
   ```

4. **Update meta tags** - Change title and remove `noindex`:
   ```html
   <!-- Change from -->
   <title>Golf Course Weather & Forecast | Fairway Weather – DEV</title>
   <meta name="robots" content="noindex, nofollow" />
   
   <!-- To -->
   <title>Golf Course Weather & Forecast | Fairway Weather</title>
   <meta name="robots" content="index, follow" />
   ```

5. **Remove body padding** - Delete inline style for dev banner offset:
   ```html
   <!-- In the <style> block, delete: -->
   body {
     padding-top: 32px;
   }
   ```

### Step 4: Update Production `config.js`

Edit `config.js` to fix the dataset path:

```javascript
// Change from
DATASET_BASE_PATH: "../data/courses",

// To
DATASET_BASE_PATH: "./data/courses",
```

### Step 5: Update Production `styles.css`

Remove the DEV-specific CSS (if any was added inline to `index.html`, it should already be removed in Step 3).

### Step 6: Commit and Deploy

```bash
git add index.html app.js config.js styles.css
git commit -m "Promote expanded golf course coverage to production

Countries: UK, Ireland, USA, Canada, Australia, New Zealand, South Africa,
Zimbabwe, France, Germany, Spain, Portugal, Netherlands, Sweden, Denmark,
Norway, Finland, Italy, Switzerland, Austria, UAE, Morocco, Turkey, Japan,
South Korea, Mexico, Belgium, Czechia, Poland, Greece, Thailand, Malaysia,
Singapore, India, China"

git push origin main
```

---

## Post-Promotion Verification

After deployment to GitHub Pages:

- [ ] Production site loads without errors
- [ ] No DEV banner visible
- [ ] Country selector works with all countries
- [ ] Search works for UK, USA, and other countries
- [ ] Weather forecast displays correctly
- [ ] Mobile layout is correct
- [ ] Check browser console for any errors

---

## Rollback Procedure

If issues are detected after promotion:

```bash
# Restore backup files
cp index.html.bak index.html
cp app.js.bak app.js
cp config.js.bak config.js
cp styles.css.bak styles.css

git add .
git commit -m "Rollback: Revert to previous production version"
git push origin main
```

---

## Future Maintenance

### Adding New Countries

1. Add country to `GEOFABRIK_URLS` in `scripts/build_courses.py`
2. Add country to `COUNTRIES` array in `config.js` (both dev and production)
3. Run build script or trigger GitHub Action
4. Deploy updated files

### Updating Existing Data

The GitHub Action runs weekly to refresh all datasets. No manual intervention needed.

### Troubleshooting Empty Countries

If a country shows no results:
1. Check if the JSON file exists in `/data/courses/`
2. Check if OpenStreetMap has golf course data for that country
3. Verify the country code matches the filename

---

*Created: January 2026*
