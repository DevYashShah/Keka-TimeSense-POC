chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  const url = tab.url || '';
  const isAttendancePage = /keka\.com\/\#\/me\/attendance\/logs/.test(url);

  const calendarSection = document.querySelector('.calendar-section');
  const header = document.getElementById('header-section');
  let messageDiv = document.getElementById('keka-message');
  if (!messageDiv) {
    messageDiv = document.createElement('div');
    messageDiv.id = 'keka-message';
    messageDiv.style.display = 'none';
    messageDiv.style.padding = '32px 16px';
    messageDiv.style.textAlign = 'center';
    messageDiv.style.fontSize = '1.1rem';
    messageDiv.style.color = '#dc2626';
    messageDiv.style.fontFamily = "'Calibri', Arial, sans-serif";
    document.body.appendChild(messageDiv);
  }

  if (!isAttendancePage) {
    calendarSection.style.display = 'none';
    header.style.display = 'none';
    messageDiv.textContent = 'Please visit your Keka Attendance Logs page before using this extension.';
    messageDiv.style.display = 'block';
    return;
  } else {
    calendarSection.style.display = '';
    header.style.display = '';
    messageDiv.style.display = 'none';
  }

  // 1. Get monthly logs and render calendar immediately
  console.log('[KekaTimeSense] Step 1: Scraping monthly logs from page...');
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: function () {
      console.log('[KekaTimeSense] [INJECTED] Scraping logs...');
      function cleanText(el) {
        return el ? el.innerText.trim().replace(/\s+/g, ' ') : '';
      }
      const rows = document.querySelectorAll('.attendance-logs-row > [dropdowntoggle].d-flex');
      const logs = [];
      const today = new Date();
      const currentMonth = today.toLocaleString('default', { month: 'short' });
      const currentDay = today.getDate();
      rows.forEach(row => {
        const date = cleanText(row.querySelector('.w-250 span'));
        const w50s = row.querySelectorAll('.w-50');
        let effective = '';
        if (w50s.length >= 1) {
          effective = cleanText(w50s[0].querySelector('span'));
        }
        // Only add logs for today or earlier
        const dateMatch = date && date.match(/(\w{3}) (\d{1,2})/);
        if (date && effective && dateMatch) {
          const logMonth = dateMatch[1];
          const logDay = parseInt(dateMatch[2]);
          if (
            logMonth === currentMonth &&
            logDay <= currentDay
          ) {
            logs.push({ date, effective });
          }
        }
      });
      console.log('[KekaTimeSense] [INJECTED] Scraped logs:', logs);
      return logs;
    },
    world: 'MAIN'
  }, async (results) => {
    const logs = results[0].result;
    console.log('[KekaTimeSense] Step 2: Rendering calendar with logs:', logs);
    
    // 2. Render the UI with day wise time log on the calendar view
    renderCalendar(logs, new Date());

    // Calculate deficit hours and show at top of Attendance section
    calculateAndDisplayDeficit(logs);

    // 3. Get today's effective hours from popup
    getTodaysEffectiveHours(tab.id, logs);
  });
});

function calculateAndDisplayDeficit(logs) {
  let totalDeficit = 0;
  const now = new Date();
  const todayNum = now.getDate();
  
  function parseMinutes(timeStr) {
    if (!timeStr || timeStr === '--') return 0;
    const match = timeStr.match(/(\d+)h\s*(\d+)m/);
    return match ? (parseInt(match[1]) * 60 + parseInt(match[2])) : 0;
  }
  
  logs.forEach(log => {
    // Parse the day from log.date (e.g., "Jun 13, Fri")
    const dateMatch = log.date.match(/\w{3} (\d{1,2})/);
    if (dateMatch) {
      const logDay = parseInt(dateMatch[1]);
      if (logDay < todayNum) {
        const mins = parseMinutes(log.effective);
        if (mins > 0 && mins < 510) {
          totalDeficit += (510 - mins);
        }
      }
    }
  });
  
  const deficitDiv = document.getElementById('deficit-summary');
  if (logs.length > 0) {
    if (totalDeficit > 0) {
      const h = Math.floor(totalDeficit / 60);
      const m = totalDeficit % 60;
      deficitDiv.textContent = `${h}h ${m}m`;
      deficitDiv.classList.add('has-deficit');
    } else {
      deficitDiv.textContent = 'None';
      deficitDiv.classList.remove('has-deficit');
    }
  } else {
    deficitDiv.textContent = '--';
    deficitDiv.classList.remove('has-deficit');
  }
}

function getTodaysEffectiveHours(tabId, logs) {
  console.log('[KekaTimeSense] Step 3: Getting today\'s effective hours...');
  
  // First script: Click to open popup
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: function () {
      console.log('[KekaTimeSense] [INJECTED] Step 1: Finding and clicking today row...');
      
      const today = new Date();
      const currentMonth = today.toLocaleString('default', { month: 'short' });
      const currentDay = today.getDate();
      
      const todayRow = Array.from(document.querySelectorAll('.attendance-logs-row')).find(row => {
        const dateText = row.querySelector('.w-250 span')?.innerText.trim();
        if (!dateText) return false;
        const dateMatch = dateText.match(/(\w{3}) (\d{1,2})/);
        if (!dateMatch) return false;
        const logMonth = dateMatch[1];
        const logDay = parseInt(dateMatch[2]);
        return logMonth === currentMonth && logDay === currentDay;
      });
      
      if (!todayRow) {
        console.log('[KekaTimeSense] [INJECTED] No today row found');
        return { success: false, error: 'No today row found' };
      }
      
      const w38 = todayRow.querySelector('.w-38');
      if (!w38) {
        console.log('[KekaTimeSense] [INJECTED] No .w-38 found');
        return { success: false, error: 'No .w-38 found' };
      }
      
      console.log('[KekaTimeSense] [INJECTED] Clicking .w-38 to open popup');
      w38.click();
      return { success: true };
    },
    world: 'MAIN'
  }, (results) => {
    if (results && results[0] && results[0].result && results[0].result.success) {
      console.log('[KekaTimeSense] Click successful, waiting for popup...');
      
      // Second script: Wait and extract from popup
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: function () {
            console.log('[KekaTimeSense] [INJECTED] Step 2: Extracting from popup...');
            
            function extractTimeDataFromPopup() {
              console.log('[KekaTimeSense] [INJECTED] Looking for popup...');
              
              // Try multiple selectors for the popup
              let popup = document.querySelector('.dropdown-menu-logs.show');
              if (!popup) {
                popup = document.querySelector('.dropdown-menu-logs');
              }
              
              console.log('[KekaTimeSense] [INJECTED] Found popup:', popup);
              
              if (!popup) {
                console.log('[KekaTimeSense] [INJECTED] No popup found in extraction');
                return null;
              }
              
              // Extract time data using the corrected selectors
              let totalMinutes = 0;
              let inOutPairs = [];
              
              // Find all employee sections
              const employeeSections = popup.querySelectorAll('.mb-20.ng-star-inserted');
              console.log('[KekaTimeSense] [INJECTED] Found employee sections:', employeeSections.length);
              
              employeeSections.forEach(section => {
                const employeeLabel = section.querySelector('label.font-weight-bold');
                const employeeName = employeeLabel ? employeeLabel.innerText.trim() : 'Unknown';
                
                console.log(`[KekaTimeSense] [INJECTED] Processing employee: ${employeeName}`);
                
                // Find all time entries for this employee
                const timeEntries = section.querySelectorAll('.d-flex.mt-10.ng-star-inserted');
                console.log(`[KekaTimeSense] [INJECTED] Found ${timeEntries.length} time entries for ${employeeName}`);
                
                timeEntries.forEach(entry => {
                  // Look for green arrow (check-in) and red arrow (check-out)
                  const greenArrow = entry.querySelector('.ki-green.transform-135');
                  const redArrow = entry.querySelector('.ki-red.transform-315');
                  
                  if (greenArrow && redArrow) {
                    // Get the time text elements (next sibling after the arrow)
                    const inTimeElement = greenArrow.nextElementSibling;
                    const outTimeElement = redArrow.nextElementSibling;
                    
                    if (inTimeElement && outTimeElement) {
                      const inTime = inTimeElement.innerText.trim();
                      let outTime = outTimeElement.innerText.trim();
                      
                      console.log(`[KekaTimeSense] [INJECTED] Found time pair: ${inTime} -> ${outTime}`);
                      
                      // Handle missing out time
                      if (!outTime || outTime === 'MISSING' || outTime === '') {
                        const now = new Date();
                        outTime = now.toLocaleTimeString('en-US', { 
                          hour12: true, 
                          hour: 'numeric', 
                          minute: '2-digit',
                          second: '2-digit'
                        });
                      }
                      
                      // Calculate duration
                      const duration = calculateDuration(inTime, outTime);
                      if (duration > 0) {
                        totalMinutes += duration;
                      }
                      
                      inOutPairs.push({ 
                        employee: employeeName,
                        inTime, 
                        outTime,
                        duration: formatMinutes(duration)
                      });
                    }
                  }
                });
              });
              
              function calculateDuration(inTime, outTime) {
                try {
                  const inMinutes = timeToMinutes(inTime);
                  const outMinutes = timeToMinutes(outTime);
                  
                  let diff = outMinutes - inMinutes;
                  if (diff < 0) {
                    diff += 24 * 60; // Handle next day
                  }
                  
                  return diff;
                } catch (error) {
                  console.error('[KekaTimeSense] [INJECTED] Error calculating duration:', error);
                  return 0;
                }
              }
              
              function timeToMinutes(timeStr) {
                // Handle formats like "10:38:32 AM" or "2:07:58 PM"
                const timeRegex = /(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)/i;
                const match = timeStr.match(timeRegex);
                
                if (!match) {
                  throw new Error(`Invalid time format: ${timeStr}`);
                }
                
                let hours = parseInt(match[1]);
                const minutes = parseInt(match[2]);
                const ampm = match[4].toUpperCase();
                
                // Convert to 24-hour format
                if (ampm === 'PM' && hours !== 12) {
                  hours += 12;
                } else if (ampm === 'AM' && hours === 12) {
                  hours = 0;
                }
                
                return hours * 60 + minutes;
              }
              
              function formatMinutes(mins) {
                if (mins <= 0) return '0h 0m';
                const hours = Math.floor(mins / 60);
                const minutes = mins % 60;
                return `${hours}h ${minutes}m`;
              }
              
              const effective = formatMinutes(totalMinutes);
              console.log('[KekaTimeSense] [INJECTED] Calculated effective time:', effective);
              console.log('[KekaTimeSense] [INJECTED] In/Out pairs:', inOutPairs);
              
              return { effective, inOutPairs };
            }
            
            // Call the extraction function
            const result = extractTimeDataFromPopup();
            console.log('[KekaTimeSense] [INJECTED] Final extraction result:', result);
            return result;
          },
          world: 'MAIN'
        }, (results) => {
          console.log('[KekaTimeSense] Script execution results:', results);
          console.log('[KekaTimeSense] Results type:', typeof results);
          console.log('[KekaTimeSense] Results length:', results ? results.length : 'null');
          console.log('[KekaTimeSense] First result:', results && results[0] ? results[0] : 'null');
          console.log('[KekaTimeSense] Result type:', results && results[0] ? typeof results[0].result : 'null');
          
          if (results && results[0] && results[0].result) {
            const popupData = results[0].result;
            console.log('[KekaTimeSense] Popup data received:', popupData);
            
            if (popupData && popupData.effective) {
              // Update today's effective hours in the UI
              const todayEffectiveElement = document.getElementById("today-effective");
              if (todayEffectiveElement) {
                todayEffectiveElement.textContent = popupData.effective;
                console.log('[KekaTimeSense] Updated UI with effective time:', popupData.effective);
              } else {
                console.error('[KekaTimeSense] Could not find today-effective element in UI');
              }
              
                          // Update styling based on hours
          const todayCard = document.getElementById("today-summary");
          if (todayCard) {
            function parseHours(timeStr) {
              if (!timeStr || timeStr === '--') return 0;
              const match = timeStr.match(/(\d+)h\s*(\d+)m/);
              return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 0;
            }
            
            const todayEffectiveMinutes = parseHours(popupData.effective);
            if (todayEffectiveMinutes > 0 && todayEffectiveMinutes < 508) {
              todayCard.classList.add('low-hours');
            } else {
              todayCard.classList.remove('low-hours');
            }
          }
              
              console.log('[KekaTimeSense] Successfully updated header with today effective:', popupData.effective);
            } else {
              console.log('[KekaTimeSense] No effective time data received, using fallback');
              useFallbackFromLogs(logs);
            }
          } else {
            console.log('[KekaTimeSense] No results from popup script, using fallback');
            useFallbackFromLogs(logs);
          }
        });
      }, 1000); // Wait 1 second for popup to load
    } else {
      console.log('[KekaTimeSense] Click failed, using fallback');
      useFallbackFromLogs(logs);
    }
  });
}

function useFallbackFromLogs(logs) {
  console.log('[KekaTimeSense] Using fallback from logs');
  const today = new Date();
  const currentMonth = today.toLocaleString('default', { month: 'short' });
  const currentDay = today.getDate();
  
  const todayLog = logs.find(log => {
    const dateMatch = log.date.match(/(\w{3}) (\d{1,2})/);
    return dateMatch && dateMatch[1] === currentMonth && parseInt(dateMatch[2]) === currentDay;
  });
  
  if (todayLog) {
    const todayEffectiveElement = document.getElementById("today-effective");
    if (todayEffectiveElement) {
      todayEffectiveElement.textContent = todayLog.effective;
      console.log('[KekaTimeSense] Updated UI with fallback effective time:', todayLog.effective);
    }
  } else {
    console.log('[KekaTimeSense] No today log found in fallback');
  }
}

  function renderKekaUI(summary) {
  // Helper function to parse hours and minutes from text like "8h 30m"
  function parseHours(timeStr) {
    if (!timeStr || timeStr === '--') return 0;
    const match = timeStr.match(/(\d+)h\s*(\d+)m/);
    return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 0;
  }

  // Set today's effective hours
  document.getElementById("today-effective").textContent = summary.todayEffective;

  // Check if effective hours < 8h 30m (510 minutes) and apply low-hours styling
  const todayCard = document.getElementById("today-summary");
  const todayEffectiveMinutes = parseHours(summary.todayEffective);
  if (todayEffectiveMinutes > 0 && todayEffectiveMinutes < 508) {
    todayCard.classList.add('low-hours');
  } else {
    todayCard.classList.remove('low-hours');
  }

  // Set month and year in the section title
  const now = new Date();
  const monthYear = now.toLocaleString('default', { month: 'long', year: 'numeric' });
  document.getElementById("month-title").textContent = monthYear;

  // Render calendar grid
  renderCalendar(summary.logs, now);
}

function renderCalendar(logs, currentDate) {
  const calendarGrid = document.getElementById('calendar-grid');
  const today = currentDate.getDate();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  
  // Create logs map for quick lookup, filter out future dates
  const logsMap = {};
  logs.forEach(log => {
    // Parse date from log (e.g., "Jun 13, Fri")
    const dateMatch = log.date.match(/(\w{3}) (\d{1,2})/);
    if (dateMatch) {
      const day = parseInt(dateMatch[2]);
      // Only allow logs for today or earlier
      const logDate = new Date(currentYear, currentMonth, day);
      const now = new Date(currentYear, currentMonth, today);
      if (logDate <= now) {
        logsMap[day] = log.effective;
      }
    }
  });

  // Helper function to parse hours and determine if they're low
  function parseHours(timeStr) {
    if (!timeStr || timeStr === '--') return 0;
    const match = timeStr.match(/(\d+)h\s*(\d+)m/);
    return match ? parseInt(match[1]) * 60 + parseInt(match[2]) : 0;
  }

  // Clear existing content
  calendarGrid.innerHTML = '';

  // Add day headers
  const dayHeaders = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayHeaders.forEach(day => {
    const dayHeader = document.createElement('div');
    dayHeader.className = 'calendar-day-header';
    dayHeader.textContent = day;
    dayHeader.style.fontFamily = "'Calibri', Arial, sans-serif";
    calendarGrid.appendChild(dayHeader);
  });

  // Get first day of month and number of days
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  // Get previous month's last few days
  const prevMonth = new Date(currentYear, currentMonth - 1, 0);
  const daysInPrevMonth = prevMonth.getDate();

  // Add previous month's trailing days
  for (let i = startingDayOfWeek - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    const dayCell = createDayCell(day, null, true, false, false);
    calendarGrid.appendChild(dayCell);
  }

  // Add current month's days
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = day === today;
    const dayOfWeek = new Date(currentYear, currentMonth, day).getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const hours = logsMap[day] || null;
    
    const dayCell = createDayCell(day, hours, false, isToday, isWeekend);
    calendarGrid.appendChild(dayCell);
  }

  // Add next month's leading days to fill the grid
  const totalCells = calendarGrid.children.length;
  const remainingCells = 42 - totalCells; // 6 rows × 7 days = 42 cells
  
  for (let day = 1; day <= remainingCells && remainingCells > 0; day++) {
    const dayCell = createDayCell(day, null, true, false, false);
    calendarGrid.appendChild(dayCell);
  }
}

function createDayCell(dayNumber, hours, isOtherMonth, isToday, isWeekend) {
  const dayCell = document.createElement('div');
  dayCell.className = 'calendar-day';
  
  if (isOtherMonth) {
    dayCell.classList.add('other-month');
  }
  if (isToday) {
    dayCell.classList.add('today');
  }
  if (isWeekend && !isOtherMonth) {
    dayCell.classList.add('weekend');
  }

  // Day number
  const dayNumberElement = document.createElement('div');
  dayNumberElement.className = 'day-number';
  dayNumberElement.textContent = dayNumber;
  dayNumberElement.style.fontFamily = "'Calibri', Arial, sans-serif";
  dayCell.appendChild(dayNumberElement);

  // Hours (if available and not other month)
  if (!isOtherMonth) {
    const hoursElement = document.createElement('div');
    hoursElement.className = 'day-hours';
    hoursElement.style.fontFamily = "'Calibri', Arial, sans-serif";
    
    if (hours) {
      // Parse hours to check if they're low
      const hoursMatch = hours.match(/(\d+)h\s*(\d+)m/);
      const totalMinutes = hoursMatch ? parseInt(hoursMatch[1]) * 60 + parseInt(hoursMatch[2]) : 0;
      
      hoursElement.textContent = hours;
      
      if (totalMinutes > 0 && totalMinutes < 508) { // Less than 8h 30m
        hoursElement.classList.add('low-hours');
      }
    } else {
      hoursElement.textContent = '--';
      hoursElement.classList.add('no-hours');
    }
    
    dayCell.appendChild(hoursElement);
  }

  return dayCell;
}