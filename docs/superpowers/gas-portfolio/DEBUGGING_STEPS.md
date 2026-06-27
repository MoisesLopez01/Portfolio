# Portfolio Debug Guide

## Current Issue
- Page shows header and hero text: "Turning messy data into decisions that scale"
- Everything after that is blank/empty
- No errors in GAS execution logs

## Most Likely Causes

### 1. CSS Display Issue
The sections might be rendering but hidden by CSS. Check:

```
Open browser DevTools (F12) → Elements tab
Look for sections after hero - are they in the DOM?
If YES → CSS is hiding them
If NO → HTML/JS is breaking
```

### 2. JavaScript Breaking Early
A syntax or runtime error is stopping execution.

**TO CHECK:**
1. Open deployed app
2. Press F12 → Console tab
3. Look for RED errors
4. Common errors:
   - `Uncaught ReferenceError: Chat is not defined`
   - `Uncaught SyntaxError`
   - `Cannot read property 'loadProjectDemo' of undefined`

### 3. Template Variable Issue
If template variables aren't being injected properly:

**TO CHECK in Code.gs:**
```javascript
function doGet(e) {
  // Make sure these variables exist
  var isAdmin = Session.getActiveUser().getEmail() === 'moisesalex.01@gmail.com';
  var projectsJson = JSON.stringify(getAllProjects());
  
  var template = HtmlService.createTemplateFromFile('index');
  template.isAdmin = isAdmin;
  template.projectsJson = projectsJson;
  
  return template.evaluate()
    .setTitle('Alex López — Data Strategist')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
```

## Quick Fix Attempts

### Option A: Temporarily Remove New Sections
Comment out the Capabilities section in index.html to see if that's causing it:

```html
<!-- Temporarily disabled for debugging
<section id="capabilities">
...
</section>
-->
```

### Option B: Check for Unclosed Tags
Run this in PowerShell from the project directory:

```powershell
$html = Get-Content "index.html" -Raw
$openTags = ([regex]::Matches($html, '<(?!/)(?!!)([a-z]+)')).Count
$closeTags = ([regex]::Matches($html, '</([a-z]+)>')).Count
Write-Host "Open tags: $openTags | Close tags: $closeTags"
```

### Option C: Validate JavaScript Syntax
Check if JavaScript.html has any syntax errors:

```
Open JavaScript.html in VS Code
Look for red squiggly lines
Check bottom-left status bar for errors
```

## What to Report Back

Please check your browser console and tell me:
1. Are there any RED errors in the Console tab?
2. In Elements tab, can you see `<section id="capabilities">` in the DOM?
3. What's the last visible element in the page before it goes blank?
