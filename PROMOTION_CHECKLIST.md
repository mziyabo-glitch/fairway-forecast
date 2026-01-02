# Promotion Checklist: DEV to Production

This document outlines the exact steps to promote the expanded golf course coverage from DEV to production once testing is complete.

## Pre-Promotion Validation

Before promoting, ensure all DEV testing is complete:

- [ ] All required countries load without errors
- [ ] Course search works for UK, Ireland, Spain, Portugal, Germany
- [ ] Zimbabwe returns results (even if limited)
- [ ] USA state selection flow works correctly
- [ ] Selecting a course triggers weather forecast correctly
- [ ] No console errors in browser DevTools
- [ ] Mobile responsiveness verified
- [ ] OpenStreetMap attribution visible
- [ ] All datasets are generated and available in `/data/courses/`

## Promotion Steps

### Step 1: Backup Current Production

Create a backup branch of current production state:

```bash
git checkout main  # or your production branch
git pull origin main
git checkout -b backup/pre-expanded-coverage-$(date +%Y%m%d)
git push origin backup/pre-expanded-coverage-$(date +%Y%m%d)
```

### Step 2: Copy DEV Files to Production Root

**Option A: Manual Copy (Recommended)**

```bash
# Copy core files
cp dev/index.html index.html
cp dev/app.js app.js
cp dev/config.js config.js
cp dev/styles.css styles.css

# Verify files were copied
ls -la index.html app.js config.js styles.css
```

**Option B: Selective Merge**

If production has customizations not in DEV, manually merge changes:

1. Compare `dev/config.js` with `config.js` - update COUNTRIES array
2. Compare `dev/app.js` with `app.js` - ensure static dataset logic is present
3. Compare `dev/index.html` with `index.html` - ensure country selector is present
4. Compare `dev/styles.css` with `styles.css` - ensure country selector styles are present

### Step 3: Update Production-Specific Settings

**Remove DEV Banner:**

In `index.html`, remove or comment out:

```html
<!-- DEV BANNER -->
<div class="ff-dev-banner">
  ⚠️ DEV ENVIRONMENT – TESTING ONLY — <a href="/">Go to Production</a>
</div>
```

And remove the related CSS from `styles.css`:

```css
/* Remove .ff-dev-banner styles */
/* Remove body { padding-top: 32px; } offset */
```

**Update Paths:**

In `index.html`, ensure all paths are correct (no `../` prefixes):

- `./config.js` (not `../config.js`)
- `./app.js` (not `../app.js`)
- `./styles.css` (not `../styles.css`)
- `./icons/` (not `../icons/`)
- `./manifest.json` (not `../manifest.json`)

**Update Meta Tags:**

Ensure production meta tags are correct (not DEV-specific):

```html
<title>Golf Course Weather & Forecast | Fairway Weather</title>
<meta name="robots" content="index, follow" />
```

**Remove DEV-Specific Code:**

In `app.js`, ensure there are no DEV-only console logs or debug code.

### Step 4: Verify Configuration

**In `config.js`, verify:**

- `COUNTRIES` array includes all required countries
- `DEFAULT_COUNTRY` is set appropriately (e.g., "gb" for UK)
- `FEATURE_STATIC_DATASETS` is `true`
- `DATASET_BASE_PATH` is `"./data/courses"` (not `"../data/courses"`)

**In `index.html`, verify:**

- Country selector is present and functional
- State selector is present (for USA)
- OpenStreetMap attribution is visible
- No "Can't find your course?" button

### Step 5: Test Production Locally

Before pushing to production:

```bash
# Serve locally to test
python3 -m http.server 8000
# or
npx serve .

# Test in browser:
# 1. Load http://localhost:8000
# 2. Select UK, search for "St Andrews"
# 3. Select USA, choose a state, search
# 4. Select other countries, verify they load
# 5. Check console for errors
# 6. Verify attribution is visible
```

### Step 6: Commit and Push

```bash
# Stage changes
git add index.html app.js config.js styles.css

# Commit with descriptive message
git commit -m "Deploy expanded golf course coverage to production

- Added 35 countries with lazy-loaded datasets
- Enabled country/state selector
- Removed 'Can't find your course?' feature
- Updated OpenStreetMap attribution
- Default country: UK"

# Push to production branch
git push origin main  # or your production branch name
```

### Step 7: Post-Deployment Verification

After GitHub Pages deployment (usually 1-2 minutes):

1. **Load Production Site:**
   - Visit production URL
   - Verify no DEV banner is visible
   - Check console for errors

2. **Test Core Functionality:**
   - [ ] UK course search works
   - [ ] USA state selection works
   - [ ] Course selection triggers weather forecast
   - [ ] Weather data loads correctly

3. **Test Expanded Countries:**
   - [ ] Ireland loads and searches
   - [ ] Spain loads and searches
   - [ ] Portugal loads and searches
   - [ ] Germany loads and searches
   - [ ] Zimbabwe returns results (even if limited)

4. **Verify Attribution:**
   - [ ] OpenStreetMap attribution visible in footer
   - [ ] OpenStreetMap attribution visible in country selector panel

5. **Mobile Testing:**
   - [ ] Test on mobile device or emulator
   - [ ] Verify country selector is usable
   - [ ] Verify search works on mobile

### Step 8: Monitor for Issues

**First 24 Hours:**
- Monitor browser console errors (if using error tracking)
- Check GitHub Pages build logs
- Monitor user feedback (if available)

**Common Issues to Watch For:**

1. **"Failed to load courses"**
   - Dataset file missing or incorrect path
   - Check `/data/courses/[country].json` exists
   - Verify `DATASET_BASE_PATH` in config.js

2. **"Loading courses..." stuck**
   - Network/CORS issue
   - Dataset file corrupted
   - Check browser console for fetch errors

3. **Country selector not showing**
   - Check `index.html` has country selector HTML
   - Check `app.js` has `initCountryStateSelectors()` call
   - Verify `config.js` has COUNTRIES array

4. **Weather not loading**
   - Cloudflare Worker API issue
   - Check network tab for API errors
   - Verify `WORKER_BASE_URL` in config.js

## Rollback Plan

If issues are discovered after promotion:

### Quick Rollback

```bash
# Revert to previous commit
git revert HEAD
git push origin main

# Or restore from backup branch
git checkout backup/pre-expanded-coverage-YYYYMMDD
git checkout -b hotfix/rollback-expanded-coverage
git push origin hotfix/rollback-expanded-coverage
# Then merge to main
```

### Partial Rollback

If only specific countries have issues:

1. Remove problematic countries from `config.js` COUNTRIES array
2. Commit and push
3. Fix dataset issues
4. Re-add countries in follow-up deployment

## Post-Promotion Tasks

After successful promotion:

- [ ] Update `DEV_NOTES.md` with production deployment date
- [ ] Archive or update `PROMOTION_CHECKLIST.md` with actual deployment notes
- [ ] Monitor analytics for country usage patterns
- [ ] Plan follow-up improvements based on user feedback

## Notes

- **Production must remain stable** - Only promote when DEV testing is complete
- **Dataset availability** - Not all countries may have datasets yet; missing datasets will show errors
- **USA logic** - USA continues to use state-by-state selection (unchanged)
- **Attribution** - OpenStreetMap attribution is required and must remain visible

---

*Created: 2024*
*Last updated: 2024*
