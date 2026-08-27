// ==========================================
// FIREBASE DATABASE FUNCTIONS (BULLETPROOF)
// ==========================================

// Helper to wait for Firebase module to finish loading
function waitForFirebase() {
  return new Promise((resolve) => {
    let checks = 0;
    const interval = setInterval(() => {
      if (window.db || checks > 30) { // Wait up to 3 seconds
        clearInterval(interval);
        resolve();
      }
      checks++;
    }, 100);
  });
}

async function getBookings() {
  await waitForFirebase(); // ⏳ Wait for Firebase to be ready
  if (!window.db) {
    console.error("Firebase failed to load!");
    return []; 
  }
  
  const { collection, getDocs } = window.firebaseFunctions;
  try {
    // Fetch all bookings (Removed orderBy to prevent silent query errors)
    const querySnapshot = await getDocs(collection(window.db, "bookings"));
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error fetching from Firebase:", error);
    return [];
  }
}

async function addBooking(bookingDataArray) {
  await waitForFirebase(); // ⏳ Wait for Firebase to be ready
  if (!window.db) throw new Error("Firebase failed to load");

  const { collection, addDoc } = window.firebaseFunctions;
  const promises = bookingDataArray.map(data => addDoc(collection(window.db, "bookings"), data));
  await Promise.all(promises);
}

async function updateBookingStatus(bookingId, newStatus) {
  await waitForFirebase(); // ⏳ Wait for Firebase to be ready
  if (!window.db) return;

  const { collection, getDocs, query, where, updateDoc, doc } = window.firebaseFunctions;
  const q = query(collection(window.db, "bookings"), where("bookingId", "==", bookingId));
  const querySnapshot = await getDocs(q);
  const promises = querySnapshot.docs.map(document => 
    updateDoc(doc(window.db, "bookings", document.id), { status: newStatus })
  );
  await Promise.all(promises);
}

// ==========================================
// CONSTANTS
// ==========================================
const TIME_SLOTS = [
  "06:00", "07:00", "08:00", "09:00", 
  "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"
];
const COURTS = ['Court 1', 'Court 2'];
let currentFilter = 'am';

let currentPage = 1;
const itemsPerPage = 7;
// Global variables for add-on quantities
let paddleQty = 0;
let ballQty = 0;

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function getWeekDates() {
  const dates = [];
  const curr = new Date();
  const first = curr.getDate() - curr.getDay();
  
  for (let i = 0; i < 7; i++) {
    const day = new Date(curr.setDate(first + i));
    const dayCopy = new Date(day);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    dates.push({
      dateObj: dayCopy,
      dateStr: dayCopy.toISOString().split('T')[0],
      dayName: dayCopy.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase(),
      dayNum: dayCopy.getDate(),
      isToday: dayCopy.toDateString() === new Date().toDateString(),
      isPast: dayCopy < today
    });
  }
  return dates;
}

function formatTime12(time24) {
  const [hours] = time24.split(':');
  const h = parseInt(hours);
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return `${h12}:00 ${ampm}`;
}

function isSlotInPast(dateStr, timeStr) {
  if (!dateStr || !timeStr) return false;
  const now = new Date();
  // Combine date and time to check if it's before the current moment
  const slotDate = new Date(`${dateStr}T${timeStr}:00`);
  return slotDate < now;
}

function getFilteredTimeSlots() {
  if (currentFilter === 'am') return TIME_SLOTS.filter(t => parseInt(t) < 12);
  if (currentFilter === 'pm') return TIME_SLOTS.filter(t => parseInt(t) >= 12);
  return TIME_SLOTS;
}

// Form calculator for the Customer Booking Page (Safe for Admin Page too)
function updateFormTotal() {
  // 1. Check if we are actually on the booking page
  const durationEl = document.getElementById('bookingDuration');
  const hiddenTimeEl = document.getElementById('hiddenTime');
  
  // If these don't exist (like on the admin page), stop running this function!
  if (!durationEl || !hiddenTimeEl) return; 

  const paddleQtyEl = document.getElementById('paddleQty');
  const ballQtyEl = document.getElementById('ballQty');
  const addonsDisplay = document.getElementById('addonsPriceDisplay');
  const totalDisplay = document.getElementById('grandTotalDisplay');

  const duration = parseInt(durationEl.value) || 1;
  const paddleQty = parseInt(paddleQtyEl ? paddleQtyEl.textContent : 0) || 0;
  const ballQty = parseInt(ballQtyEl ? ballQtyEl.textContent : 0) || 0;
  const selectedTime = hiddenTimeEl.value;

  let courtPrice = 0;
  if (selectedTime) {
    const hourlyRate = isAM(selectedTime) ? RATE_AM : RATE_PM;
    courtPrice = hourlyRate * duration;
  }

  const addonsPrice = (paddleQty * 30) + (ballQty * 100);
  const total = courtPrice + addonsPrice;

  if (addonsDisplay) addonsDisplay.textContent = `₱${addonsPrice}`;
  if (totalDisplay) totalDisplay.textContent = `₱${total}`;
}
// ==========================================
// CALENDAR RENDERING
// ==========================================
async function renderCalendar() {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return;
  
  const weekDates = getWeekDates();
  const db = await getBookings();
  const filteredTimes = getFilteredTimeSlots();
  
  let html = '<div class="calendar-cell calendar-header"></div>';
  
  weekDates.forEach(day => {
    html += `<div class="calendar-cell calendar-header ${day.isToday ? 'today' : ''}">
      <span class="day-name">${day.dayName}</span>
      <span class="day-num">${day.dayNum}</span>
    </div>`;
  });

  for (const time of filteredTimes) {
    html += `<div class="calendar-cell time-label">${formatTime12(time)}</div>`;
    
    for (const day of weekDates) {
      let cellClass = 'calendar-cell slot-cell';
      if (day.isPast) cellClass += ' past';
      
      html += `<div class="${cellClass}">`;
      
      for (const court of COURTS) {
        if (day.isPast) {
          html += `<div class="court-status">
            <span class="court-name">${court}</span>
            <span class="status-text past">Past</span>
          </div>`;
                       } else {
          // Find the specific booking object for this exact slot
          const booking = db.find(b => 
            b.date === day.dateStr && 
            b.court === court && 
            b.time === time && 
            b.status !== 'cancelled'
          );
          
                    // Smart Duration Calculation:
          // If the booking exists, check its saved duration. If not saved, calculate it dynamically.
          let duration = booking ? (booking.duration || 1) : 1;
          
          if (booking && !booking.duration) {
            let nextHour = parseInt(time.split(':')[0]) + 1;
            while (db.some(b => 
              b.date === day.dateStr && 
              b.court === court && 
              b.time === `${nextHour.toString().padStart(2, '0')}:00` && 
              b.status !== 'cancelled' && 
              b.id === booking.id
            )) {
              duration++;
              nextHour++;
            }
          }

                    const settings = getFacilitySettings();
          const courtStatus = settings.courts[court] || 'open';
          
          // Check for date-specific closures
          const closures = JSON.parse(localStorage.getItem('hirayaScheduledClosures')) || [];
          const scheduledClosure = closures.find(c => 
            c.date === day.dateStr && (c.court === court || c.court === 'All')
          );

          let statusClass = 'open';
          let statusText = 'Open';
          let clickAction = `onclick="selectSlot('${day.dateStr}', '${time}', '${court}')"`;

          // 0. Check if the specific time slot has already passed today
          if (isSlotInPast(day.dateStr, time)) {
            statusClass = 'past';
            statusText = 'Past';
            clickAction = '';
          }

          // 1. Check Scheduled Date Closure (Highest Priority)

          // 1. Check Scheduled Date Closure (Highest Priority)
          if (scheduledClosure) {
            statusClass = scheduledClosure.reason === 'tournament' ? 'tournament' : 'maintenance';
            statusText = scheduledClosure.reason === 'tournament' ? 'Event' : 'Maint.';
            clickAction = '';
          } 
          // 2. Check General Court Status
          else if (courtStatus === 'maintenance') {
            statusClass = 'maintenance';
            statusText = 'Maint.';
            clickAction = '';
          } else if (courtStatus === 'tournament') {
            statusClass = 'tournament';
            statusText = 'Event';
            clickAction = '';
          } 
          // 3. Check Bookings
          else if (booking) {
            if (booking.status === 'confirmed') {
              statusClass = 'booked';
              statusText = 'Booked';
              clickAction = '';
            } else if (booking.status === 'pending') {
              statusClass = 'pending';
              statusText = 'Pending';
              clickAction = '';
            }
          }
          
          html += `<div class="court-status">
            <span class="court-name">${court}</span>
            <span class="status-text ${statusClass}" ${clickAction}>${statusText}</span>
          </div>`;
        }
      }
      html += `</div>`;
    }
  }
  
  grid.innerHTML = html;
}

function selectSlot(date, time, court) {
  document.getElementById('hiddenDate').value = date;
  document.getElementById('hiddenTime').value = time;
  document.getElementById('hiddenCourt').value = court;
  document.getElementById('selectedSlotDisplay').value = `${date} | ${formatTime12(time)} | ${court}`;
  document.querySelector('.booking-form-section').scrollIntoView({ behavior: 'smooth' });
  
  const clearSlotBtn = document.getElementById('clearSlotBtn');
  if (clearSlotBtn) clearSlotBtn.disabled = false;

  // 🌟 ADD THIS LINE: Recalculate the total now that a slot is selected!
  updateFormTotal();
}

// ==========================================
// INITIALIZATION & EVENT LISTENERS
// ==========================================

  // Add this inside DOMContentLoaded, near the other event listeners
  const durationSelect = document.getElementById('bookingDuration');
  if (durationSelect) {
    durationSelect.addEventListener('change', updateFormTotal);
  }
document.addEventListener('DOMContentLoaded', () => {
    renderCalendar();
  renderMobileSchedule(); // Initialize mobile view
  
  // Only calculate form totals if we are on the booking page
  if (document.getElementById('bookingDuration')) {
    updateFormTotal();
  }
  
  // AM/PM Filter Button Logic
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      currentFilter = e.target.dataset.filter;
      renderCalendar();
        // Also render mobile view
  renderMobileSchedule();
    });
  });

  

  // ==========================================
// MOBILE SCHEDULE LIST RENDERING
// ==========================================

async function renderMobileSchedule() {
  const listContainer = document.getElementById('mobileScheduleList');
  if (!listContainer) return;
  
  const weekDates = getWeekDates();
  const db = await getBookings();
  const filteredTimes = getFilteredTimeSlots();
  
  let html = '';
  
  // Group by day
  weekDates.forEach(day => {
    // Skip rendering if all times are past
    if (day.isPast) return;
    
    html += `<div class="mobile-day-group">
      <div class="mobile-day-header ${day.isToday ? 'today' : ''}">
        <span class="day-name">${day.dayName}</span>
        <span class="day-num">${day.dayNum}</span>
      </div>
      <div class="mobile-day-slots">`;
    
    // Render each time slot
    filteredTimes.forEach(time => {
      html += `<div class="mobile-time-slot">
        <div class="mobile-time-label">${formatTime12(time)}</div>
        <div class="mobile-court-slots">`;
      
    
      // Render each court
      COURTS.forEach(court => {
        // Check if this specific time slot is in the past
        if (isSlotInPast(day.dateStr, time)) {
          html += `<div class="mobile-court-item">
            <span class="mobile-court-name">${court}</span>
            <span class="mobile-status past">Past</span>
          </div>`;
          return; // Skip to the next court
        }

        const booking = db.find(b => 
          b.date === day.dateStr &&  
          b.court === court && 
          b.time === time && 
          b.status !== 'cancelled'
        );
        
        const isBooked = !!booking;
        const statusClass = isBooked ? 'booked' : 'open';
        const statusText = isBooked ? 'Booked' : 'Open';
        const clickAction = !isBooked ? `onclick="selectSlot('${day.dateStr}', '${time}', '${court}')"` : '';
        
        html += `<div class="mobile-court-item">
          <span class="mobile-court-name">${court}</span>
          <span class="mobile-status ${statusClass}" ${clickAction}>${statusText}</span>
        </div>`;
      });
      
      html += `</div></div>`;
    });
    
    html += `</div></div>`;
  });
  
  // If no schedule was generated, show empty state
  if (html === '') {
    listContainer.innerHTML = '<p style="text-align: center; color: var(--gray-500); padding: 2rem;">No available slots this week.</p>';
  } else {
    listContainer.innerHTML = html;
  }
}
  // Add-on Quantity Logic
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const type = e.target.dataset.type;
      const isPlus = e.target.classList.contains('plus');

      if (type === 'paddle') {
        if (isPlus) paddleQty++;
        else if (paddleQty > 0) paddleQty--;
        document.getElementById('paddleQty').textContent = paddleQty;
      } else if (type === 'ball') {
        if (isPlus) ballQty++;
        else if (ballQty > 0) ballQty--;
        document.getElementById('ballQty').textContent = ballQty;
      }
      updateFormTotal();
    });
  });

  // Duration Dropdown Logic
  const durationSelect = document.getElementById('bookingDuration');
  if (durationSelect) {
    durationSelect.addEventListener('change', updateFormTotal);
  }

      // Clear Slot Button Logic
  const clearSlotBtn = document.getElementById('clearSlotBtn');
  if (clearSlotBtn) {
    clearSlotBtn.addEventListener('click', () => {
      document.getElementById('selectedSlotDisplay').value = '';
      document.getElementById('hiddenDate').value = '';
      document.getElementById('hiddenTime').value = '';
      document.getElementById('hiddenCourt').value = '';
      clearSlotBtn.disabled = true;
      
      // Reset the total price to 0 when slot is cleared
      updateFormTotal(); 
      renderMobileSchedule(); // Refresh mobile view
    });
  }

    // ==========================================
  // STEP 1: SHOW REVIEW MODAL ON SUBMIT
  // ==========================================
  const bookingForm = document.getElementById('bookingForm');
  if (bookingForm) {
    bookingForm.addEventListener('submit', (e) => {
      e.preventDefault(); // Stop it from saving immediately
      
      const date = document.getElementById('hiddenDate').value;
      const startTimeStr = document.getElementById('hiddenTime').value; // 🌟 GRAB THE TIME
      
      if (!date || !startTimeStr) { 
        alert('Please select a time slot from the calendar above.'); 
        return; 
      }

      // Gather Data for Review
      const name = document.getElementById('customerName').value;
      const mobile = document.getElementById('customerMobile').value;
      const email = document.getElementById('customerEmail').value;
      const duration = parseInt(document.getElementById('bookingDuration').value) || 1;
      const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
      const slotDisplay = document.getElementById('selectedSlotDisplay').value;
      
      const addonsText = [];
      if (paddleQty > 0) addonsText.push(`${paddleQty}x Paddle (₱${paddleQty * 30})`);
      if (ballQty > 0) addonsText.push(`${ballQty}x Ball (₱${ballQty * 100})`);
      const addonsDisplay = addonsText.length > 0 ? addonsText.join(', ') : 'None';

      // 🌟 FIX: Calculate base price based on AM/PM
      let hourlyRate = 300; // Default to PM rate
      const timeLower = startTimeStr.toLowerCase();
      const hour = parseInt(startTimeStr.split(':')[0]);
      
      if ((timeLower.includes('am') && !timeLower.includes('12:00')) || (hour < 12 && !timeLower.includes('pm'))) {
        hourlyRate = 200; // AM Rate
      }

      const basePrice = hourlyRate * duration; // 🌟 Uses the correct rate!
      const addonsPrice = (paddleQty * 30) + (ballQty * 100);
      const totalAmount = basePrice + addonsPrice;

      // Populate Review Modal
      document.getElementById('rev-name').textContent = name;
      document.getElementById('rev-mobile').textContent = mobile;
      document.getElementById('rev-email').textContent = email;
      document.getElementById('rev-slot').textContent = slotDisplay;
      document.getElementById('rev-duration').textContent = `${duration} Hour(s)`;
      document.getElementById('rev-addons').textContent = addonsDisplay;
      document.getElementById('rev-payment').textContent = paymentMethod === 'gcash' ? 'GCash' : 'Pay on Venue';
      document.getElementById('rev-total').textContent = `₱${totalAmount}`;

      // Show the Modal
      document.getElementById('reviewModal').classList.remove('hidden');
    });
  }

    // ==========================================
  // STEP 2: FINALIZE BOOKING (After Review)
  // ==========================================
  const finalizeBtn = document.getElementById('finalizeBookingBtn');
  if (finalizeBtn) {
    finalizeBtn.addEventListener('click', async () => {
      // Re-grab the data
      const date = document.getElementById('hiddenDate').value;
      const startTimeStr = document.getElementById('hiddenTime').value;
      const court = document.getElementById('hiddenCourt').value;
      const duration = parseInt(document.getElementById('bookingDuration').value) || 1;
      const paymentMethod = document.querySelector('input[name="payment"]:checked').value;

      // 🌟 FIX: Calculate dynamic AM/PM pricing ONCE here
      let hourlyRate = 300; // Default to PM
      const timeLower = startTimeStr.toLowerCase();
      const hour = parseInt(startTimeStr.split(':')[0]);
      
      if ((timeLower.includes('am') && !timeLower.includes('12:00')) || (hour < 12 && !timeLower.includes('pm'))) {
        hourlyRate = 200; // AM Rate
      }

      const basePrice = hourlyRate * duration;
      const addonsTotal = (paddleQty * 30) + (ballQty * 100);
      const totalAmount = basePrice + addonsTotal; // 🌟 THE CORRECT TOTAL

      const db = await getBookings(); // ✅ Fetches from Firebase
      const startHour = parseInt(startTimeStr.split(':')[0]);
      let isAvailable = true;

      // VALIDATION: Check if ALL requested hours are available
      for (let i = 0; i < duration; i++) {
        const checkHour = startHour + i;
        const checkTimeStr = `${checkHour.toString().padStart(2, '0')}:00`;
        
        const isBooked = db.some(b => 
          b.date === date && 
          b.court === court && 
          b.time === checkTimeStr && 
          b.status !== 'cancelled'
        );

        if (isBooked) {
          isAvailable = false;
          break;
        }
      }

      if (!isAvailable) {
        alert(`Sorry, the court is no longer available for ${duration} hour(s). Another booking overlaps with this time.`);
        closeReviewModal();
        return;
      }

      // SAVE BOOKINGS
          const bookingId = 'TEMP-' + Math.floor(Math.random() * 10000);
      const status = 'pending'; 
      const bookingsToSave = [];

      for (let i = 0; i < duration; i++) {
        const currentHour = startHour + i;
        const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:00`;

        bookingsToSave.push({
          bookingId: bookingId, // We use 'bookingId' for our custom ID
          date: date,
          time: currentTimeStr,
          court: court,
          name: document.getElementById('customerName').value,
          mobile: document.getElementById('customerMobile').value,
          email: document.getElementById('customerEmail').value,
          payment: paymentMethod,
          addons: { paddle: paddleQty, ball: ballQty },
          duration: duration,
          status: status,
          totalAmount: totalAmount
        });
      }
      
      await addBooking(bookingsToSave); // Saves to the cloud!

      // Trigger Admin Email
      notifyAdminOfNewBooking({
        id: bookingId,
        date: date,
        time: startTimeStr,
        court: court,
        duration: duration,
        name: document.getElementById('customerName').value,
        email: document.getElementById('customerEmail').value,
        mobile: document.getElementById('customerMobile').value,
        payment: paymentMethod,
        addons: { paddle: paddleQty, ball: ballQty },
        totalAmount: totalAmount, // 🌟 ADDED: So the admin email shows the correct price!
        status: status
      });
      
      // Close Review Modal
      closeReviewModal();
      
      // Show the beautiful Success Modal
      const customerEmail = document.getElementById('customerEmail').value;
      openSuccessModal(customerEmail);
      
      // Handle GCash Modal if needed
      if (paymentMethod === 'gcash') {
        const reference = 'HIRAYA-' + Math.floor(Math.random() * 100000);
        
        setTimeout(() => {
          // 🌟 FIX: Use the dynamically calculated totalAmount, not hardcoded 300
          openGcashModal(totalAmount, reference);
        }, 500);
      }
      
      // Reset Form & UI
      bookingForm.reset();
      document.getElementById('selectedSlotDisplay').value = '';
      document.getElementById('hiddenDate').value = '';
      document.getElementById('hiddenTime').value = '';
      document.getElementById('hiddenCourt').value = '';
      const clearSlotBtn = document.getElementById('clearSlotBtn');
      if (clearSlotBtn) clearSlotBtn.disabled = true;

      paddleQty = 0;
      ballQty = 0;
      document.getElementById('paddleQty').textContent = '0';
      document.getElementById('ballQty').textContent = '0';
      updateFormTotal();
      renderCalendar();
      renderMobileSchedule(); // Update mobile view after booking
    });
  }

  // Lookup Logic (Multi-Hour Support)
  const lookupBtn = document.getElementById('lookupBtn');
  const lookupInput = document.getElementById('lookupInput');
  const lookupResult = document.getElementById('lookupResult');
  
  if (lookupBtn && lookupInput && lookupResult) {
    lookupBtn.addEventListener('click', async () => { // Added 'async'
      const query = lookupInput.value.trim();
      if (!query) {
        alert('Please enter a Booking ID or Phone Number');
        return;
      }

         const db = await getBookings();
      
      // Get ALL active bookings matching the query
      const activeBookings = db.filter(b => {
        if (!b || b.status === 'cancelled') return false;
        const matchId = b.bookingId === query;
        const matchMobile = b.mobile === query;
        const matchMobileNumbersOnly = b.mobile && b.mobile.replace(/\D/g,'') === query.replace(/\D/g,'');
        return (matchId || matchMobile || matchMobileNumbersOnly);
      });

      if (activeBookings.length > 0) {
        activeBookings.sort((a, b) => a.time.localeCompare(b.time));
        
        const firstBooking = activeBookings[0];
        const lastBooking = activeBookings[activeBookings.length - 1];
        
        const lastHour = parseInt(lastBooking.time.split(':')[0]);
        const endHour = lastHour + 1;
        
        const startTimeStr = formatTime12(firstBooking.time);
        const endTimeStr = formatTime12(`${endHour.toString().padStart(2, '0')}:00`);
        const duration = activeBookings.length;

         const addons = firstBooking.addons || { paddle: 0, ball: 0 };
        const total = calculateBookingTotal(firstBooking); // ✅ Dynamic pricing
        
        let addonsText = 'None';
        if ((addons.paddle || 0) > 0 || (addons.ball || 0) > 0) {
          const addonList = [];
          if (addons.paddle > 0) addonList.push(`${addons.paddle}x Paddle`);
          if (addons.ball > 0) addonList.push(`${addons.ball}x Ball`);
          addonsText = addonList.join(', ');
        }

        lookupResult.innerHTML = `
          <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid var(--success);">
            <h3 style="margin-bottom: 16px; color: var(--purple-dark);">✓ Active Booking Found</h3>
            <div style="display: grid; gap: 12px; font-size: 0.95rem;">
              <div><strong>Booking ID:</strong> ${firstBooking.bookingId || 'N/A'}</div>
              <div><strong>Date:</strong> ${firstBooking.date || 'N/A'}</div>
              <div><strong>Time:</strong> ${startTimeStr} to ${endTimeStr} <span style="color: var(--purple-dark); font-weight: 700;">(${duration} Hour${duration > 1 ? 's' : ''})</span></div>
              <div><strong>Court:</strong> ${firstBooking.court || 'N/A'}</div>
              <div><strong>Name:</strong> ${firstBooking.name || 'N/A'}</div>
              <div><strong>Email:</strong> ${firstBooking.email || 'N/A'}</div>
              <div><strong>Mobile:</strong> ${firstBooking.mobile || 'N/A'}</div>
              <div><strong>Payment:</strong> ${(firstBooking.payment || 'N/A').toUpperCase()}</div>
              <div><strong>Add-ons:</strong> ${addonsText}</div>
              <div><strong>Total Paid:</strong> <span style="color: var(--success); font-weight: 700; font-size: 1.1rem;">₱${total}</span></div>
              <div><strong>Status:</strong> <span class="status-badge ${firstBooking.status || 'confirmed'}">${(firstBooking.status || 'confirmed').toUpperCase()}</span></div>
            </div>
            <button onclick="window.cancelBookingFunc('${firstBooking.bookingId}')"
              style="margin-top: 20px; background: var(--danger); color: white; border: none; padding: 10px 20px; border-radius: 6px; font-weight: 600; cursor: pointer;">
              Cancel Booking
            </button>
          </div>
        `;
        lookupResult.classList.remove('hidden');
        lookupResult.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        const cancelledBooking = db.find(b => {
          if (!b || b.status !== 'cancelled') return false;
          const matchId = b.bookingId === query;
          const matchMobile = b.mobile === query;
          const matchMobileNumbersOnly = b.mobile && b.mobile.replace(/\D/g,'') === query.replace(/\D/g,'');
          return (matchId || matchMobile || matchMobileNumbersOnly);
        });

        if (cancelledBooking) {
          lookupResult.innerHTML = `
            <div style="background: #f3f4f6; padding: 16px; border-radius: 8px; border-left: 4px solid var(--gray-500);">
              <strong>ℹ️ No Active Bookings</strong><br>
              You don't have any active bookings at the moment.<br>
              <small style="color: var(--gray-600);">(Previous bookings have been cancelled or completed)</small>
            </div>
          `;
          lookupResult.classList.remove('hidden');
        } else {
          lookupResult.innerHTML = `
            <div style="background: #fee2e2; padding: 16px; border-radius: 8px; border-left: 4px solid var(--danger); color: #991b1b;">
              <strong>❌ No booking found</strong><br>
              Please check your Booking ID or Phone Number and try again.
            </div>
          `;
          lookupResult.classList.remove('hidden');
        }
      }
    });
  }
});

// ==========================================
// GLOBAL FUNCTIONS (Outside DOMContentLoaded)
// ==========================================
function getFacilitySettings() {
  return JSON.parse(localStorage.getItem('hirayaFacilitySettings')) || {
    facilityStatus: 'open',
    courts: { 'Court 1': 'open', 'Court 2': 'open' }
  };
}

window.cancelBookingFunc = async function(id) {
  if(confirm('Are you sure you want to cancel this booking? This will cancel ALL hours for this booking.')) {
    const db = await getBookings();
    const updated = db.map(b => {
      if (b.id === id && b.status !== 'cancelled') {
        return { ...b, status: 'cancelled' };
      }
      return b;
    });
    saveMockDB(updated);
    alert('Booking cancelled.');
    const lookupResult = document.getElementById('lookupResult');
    if (lookupResult) lookupResult.classList.add('hidden');
    renderCalendar();
  }
};

function openGcashModal(amount, reference) {
  document.getElementById('gcashAmount').textContent = `₱${amount.toFixed(2)}`;
  document.getElementById('gcashReference').textContent = reference || 'N/A';
  document.getElementById('gcashModal').classList.remove('hidden');
}

function closeGcashModal() {
  document.getElementById('gcashModal').classList.add('hidden');
}

window.openGcashModal = openGcashModal;
window.closeGcashModal = closeGcashModal;

// ==========================================
// GLOBAL CANCEL FUNCTION
// ==========================================
window.cancelBookingFunc = async function(id) {
  if(confirm('Are you sure you want to cancel this booking? This will cancel ALL hours for this booking.')) {
    const db = await getBookings();
    
    // Cancel ALL entries with this booking ID
    const updated = db.map(b => {
      if (b.id === id && b.status !== 'cancelled') {
        return { ...b, status: 'cancelled' };
      }
      return b;
    });
    
    saveMockDB(updated);
    alert('Booking cancelled.');
    document.getElementById('lookupResult').classList.add('hidden');
    renderCalendar();
  }
};

// ==========================================
// REVIEW MODAL FUNCTIONS
// ==========================================

function closeReviewModal() {
  document.getElementById('reviewModal').classList.add('hidden');
}

// ==========================================
// SUCCESS MODAL FUNCTIONS
// ==========================================

function openSuccessModal(email) {
  document.getElementById('successEmail').textContent = email;
  document.getElementById('successModal').classList.remove('hidden');
}

function closeSuccessModal() {
  document.getElementById('successModal').classList.add('hidden');
}

window.openSuccessModal = openSuccessModal;
window.closeSuccessModal = closeSuccessModal;

// Make it globally accessible
window.closeReviewModal = closeReviewModal;

// ==========================================
// GCASH MODAL FUNCTIONS
// ==========================================
function openGcashModal(amount, reference) {
  document.getElementById('gcashAmount').textContent = `₱${amount.toFixed(2)}`;
  document.getElementById('gcashReference').textContent = reference || 'N/A';
  document.getElementById('gcashModal').classList.remove('hidden');
}

function closeGcashModal() {
  document.getElementById('gcashModal').classList.add('hidden');
}

// Make functions globally accessible for HTML onclick attributes
window.openGcashModal = openGcashModal;
window.closeGcashModal = closeGcashModal;

// ==========================================
// ADMIN DASHBOARD FUNCTIONS
// ==========================================

// Check if we're on the admin page
if (document.getElementById('bookingsTableBody')) {
  initAdminDashboard();
}

function initAdminDashboard() {
  // Load data immediately
  loadAdminData();
  
  // Filter buttons
  const applyBtn = document.getElementById('applyFiltersBtn');
  const clearBtn = document.getElementById('clearFiltersBtn');
  
  if (applyBtn) applyBtn.addEventListener('click', loadAdminData);
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      document.getElementById('adminDateFilter').value = '';
      document.getElementById('adminCourtFilter').value = '';
      document.getElementById('adminStatusFilter').value = '';
      loadAdminData();
    });
  }
  
  // Export dropdown toggle
  const exportDropdownBtn = document.getElementById('exportDropdownBtn');
  const exportOptions = document.getElementById('exportOptions');
  
  if (exportDropdownBtn && exportOptions) {
    exportDropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportOptions.classList.toggle('hidden');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!exportDropdownBtn.contains(e.target) && !exportOptions.contains(e.target)) {
        exportOptions.classList.add('hidden');
      }
    });
  }
}

function calculateTotalEarnings(bookings) {
  return bookings.reduce((sum, b) => {
    if (b.status === 'cancelled') return sum;
    return sum + calculateBookingTotal(b); // 🌟 Uses universal calculator
  }, 0);
}

async function loadAdminData() {
  // 1. Wait for Firebase to fetch the data
  const db = await getBookings(); 
  const today = new Date().toISOString().split('T')[0];
  
  // 2. Get filter values safely
  const dateFilterEl = document.getElementById('adminDateFilter');
  const courtFilterEl = document.getElementById('adminCourtFilter');
  const statusFilterEl = document.getElementById('adminStatusFilter');
  
  const dateFilter = dateFilterEl ? dateFilterEl.value : '';
  const courtFilter = courtFilterEl ? courtFilterEl.value : '';
  const statusFilter = statusFilterEl ? statusFilterEl.value : '';
  
  // 3. Apply filters (Ignore cancelled bookings by default)
  let filteredBookings = db.filter(b => b.status !== 'cancelled');
  
  if (dateFilter) filteredBookings = filteredBookings.filter(b => b.date === dateFilter);
  if (courtFilter) filteredBookings = filteredBookings.filter(b => b.court === courtFilter);
  if (statusFilter) filteredBookings = filteredBookings.filter(b => b.status === statusFilter);
  
  // 4. Update stats
  const totalBookings = db.filter(b => b.status !== 'cancelled').length;
  const todayBookings = new Set(
  db
    .filter(b => b.date === today && b.status !== 'cancelled')
    .map(b => b.bookingId)
).size;
  
const todayRevenue = (() => {
  // Group today's bookings by bookingId
  const groups = {};

  db
    .filter(b => b.date === today && b.status !== 'cancelled')
    .forEach(b => {
      if (!groups[b.bookingId]) {
        groups[b.bookingId] = [];
      }

      groups[b.bookingId].push(b);
    });

  // Calculate each booking only ONCE
  return Object.values(groups).reduce((sum, group) => {
    const firstBooking = group[0];

    // Calculate the booking total once
    const bookingTotal = calculateBookingTotal(firstBooking);

    return sum + bookingTotal;
  }, 0);
})();
  
  const totalEl = document.getElementById('totalBookings');
  const todayEl = document.getElementById('todayBookings');
  const revenueEl = document.getElementById('todayRevenue');
  
  if (totalEl) totalEl.textContent = totalBookings;
  if (todayEl) todayEl.textContent = todayBookings;
  if (revenueEl) revenueEl.textContent = `₱${todayRevenue}`;
  
  // 5. Render table
  renderAdminTable(filteredBookings);
}

function renderAdminTable(bookings) {
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;

    // 1. Group bookings by our new Firebase ID
  const grouped = {};
  bookings.forEach(b => {
    if (!grouped[b.bookingId]) grouped[b.bookingId] = []; // ✅ Looking for 'bookingId'
    grouped[b.bookingId].push(b);
  });

  // 2. Convert to array of groups
  const bookingGroups = Object.values(grouped);

  if (bookingGroups.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
          </svg>
          <p>No bookings found</p>
        </td>
      </tr>
    `;
    return;
  }

// Sort bookings: latest date/time first
bookingGroups.sort((a, b) => {
  const dateA = new Date(`${a[0].date}T${a[0].time}`);
  const dateB = new Date(`${b[0].date}T${b[0].time}`);

  return dateB - dateA;
});

  tbody.innerHTML = bookingGroups.map(group => {
    // Sort the hours in this group chronologically
    group.sort((a, b) => a.time.localeCompare(b.time));
    
    const first = group[0];
    const last = group[group.length - 1];
    const duration = group.length; // Number of hours

    const total = calculateBookingTotal(first);

    // Calculate End Time
    const lastHour = parseInt(last.time.split(':')[0]);
    const endHour = lastHour + 1;
    const endTimeStr = `${endHour.toString().padStart(2, '0')}:00`;

    


    // Format Add-ons text
    const addonsText = [];
    if (first.addons?.paddle > 0) addonsText.push(`${first.addons.paddle}x Paddle`);
    if (first.addons?.ball > 0) addonsText.push(`${first.addons.ball}x Ball`);

    return `
      <tr>
        <td><strong>${first.bookingId}</strong></td>
        <td>${first.date}</td>
        <td>
          ${formatTime12(first.time)} - ${formatTime12(endTimeStr)}
          <br><small style="color:var(--gray-500)">(${duration}h)</small>
        </td>
        <td>${first.court}</td>
        <td>
          <div>${first.name}</div>
          <small style="color: var(--gray-500);">${first.mobile}</small>
        </td>
        <td>
          <span style="text-transform: capitalize; font-weight: 600;">
            ${first.payment === 'gcash' ? '📱 GCash' : '💵 Venue'}
          </span>
        </td>
        <td>${addonsText.length > 0 ? addonsText.join(', ') : '-'}</td>
        <td><strong>₱${total}</strong></td>
        <td>
          <span class="status-badge ${first.status || 'confirmed'}">
            ${first.status || 'confirmed'}
          </span>
        </td>
        <td>
          
                    <button class="action-btn cancel" onclick="cancelBookingFromAdmin('${first.bookingId}')">Cancel</button>
          <button class="action-btn view" style="background:#e0e7ff; color:#3730a3;" onclick="openEditModal('${first.bookingId}')">Edit</button>
          <button class="action-btn view" onclick="viewBookingDetails('${first.bookingId}')">View</button>
        </td>
      </tr>
    `;
  }).join('');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? '✅' : '❌';

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
        <span class="toast-close" onclick="this.parentElement.remove()">&times;</span>
    `;

    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

async function confirmBooking(id) {
  await updateBookingStatus(id, 'confirmed');
  const db = await getBookings();
  const booking = db.find(b => b.bookingId === id);
  if (booking) await notifyCustomerOfConfirmation(booking);
  showToast(`Booking ${id} confirmed! Customer notified.`, 'success');
  loadAdminData();
}

async function cancelBookingFromAdmin(id) {
  if (confirm('Are you sure you want to cancel this booking?')) {
    await updateBookingStatus(id, 'cancelled');
    showToast(`Booking ${id} has been cancelled.`, 'error');
    loadAdminData();
  }
}

async function viewBookingDetails(id) {
  const db = await getBookings();
  
  // 1. Find ALL records for this booking ID
  const bookings = db.filter(b => b.bookingId === id);
  if (bookings.length === 0) return;

  // Sort them chronologically
  bookings.sort((a, b) => a.time.localeCompare(b.time));

  const firstBooking = bookings[0];
  const lastBooking = bookings[bookings.length - 1];
  const duration = bookings.length; // Total hours booked

  // 2. Calculate End Time
  const lastHour = parseInt(lastBooking.time.split(':')[0]);
  const endHour = lastHour + 1;
  const endTimeStr = `${endHour.toString().padStart(2, '0')}:00`;

  // 3. Calculate Correct Total Price (Court fee * duration + addons)
  // 3. Calculate Correct Total Price using dynamic AM/PM rates
  const total = calculateBookingTotal(firstBooking);

  // Populate Modal Data
  document.getElementById('det-id').textContent = firstBooking.bookingId;
  document.getElementById('det-date').textContent = firstBooking.date;
  document.getElementById('det-time').textContent = `${formatTime12(firstBooking.time)} - ${formatTime12(endTimeStr)} (${duration}h)`;
  document.getElementById('det-court').textContent = firstBooking.court;
  
  const statusEl = document.getElementById('det-status');
  statusEl.textContent = (firstBooking.status || 'confirmed').toUpperCase();
  statusEl.className = `detail-value status-badge ${firstBooking.status || 'confirmed'}`;

  document.getElementById('det-name').textContent = firstBooking.name;
  document.getElementById('det-email').textContent = firstBooking.email;
  document.getElementById('det-mobile').textContent = firstBooking.mobile;
  document.getElementById('det-payment').textContent = firstBooking.payment.toUpperCase();
  document.getElementById('det-paddles').textContent = firstBooking.addons?.paddle || 0;
  document.getElementById('det-balls').textContent = firstBooking.addons?.ball || 0;
  document.getElementById('det-total').textContent = `₱${total}`;

  // Handle Action Buttons Visibility
  const confirmBtn = document.getElementById('modalConfirmBtn');
  const cancelBtn = document.getElementById('modalCancelBtn');

    // Show the Confirm button ONLY if the booking is pending
  if (firstBooking.status === 'pending') {
    confirmBtn.classList.remove('hidden');
  } else {
    confirmBtn.classList.add('hidden');
  }

  if (firstBooking.status === 'cancelled') {
    cancelBtn.classList.add('hidden');
  } else {
    cancelBtn.classList.remove('hidden');
  }

// Set up button actions for this specific booking
confirmBtn.onclick = async () => {
  await confirmBooking(firstBooking.bookingId);
  window.closeDetailsModal();
};

cancelBtn.onclick = async () => {
  await cancelBookingFromAdmin(firstBooking.bookingId);
  window.closeDetailsModal();
};

  // Show Modal
  document.getElementById('bookingDetailsModal').classList.remove('hidden');
}

window.closeDetailsModal = function() {
  document.getElementById('bookingDetailsModal').classList.add('hidden');
};

async function exportToCSV() {
  const db = await getBookings();
  const filteredBookings = db.filter(b => b.status !== 'cancelled');
  
  // ✅ GROUP BY ID to prevent duplicate rows for multi-hour bookings
  const uniqueBookings = {};
  filteredBookings.forEach(b => {
    if (!uniqueBookings[b.id]) uniqueBookings[b.id] = b;
  });
  const finalBookings = Object.values(uniqueBookings);

  let totalEarnings = 0;
  
  const headers = ['ID', 'Date', 'Time', 'Court', 'Name', 'Email', 'Mobile', 'Payment', 'Paddles', 'Balls', 'Total', 'Status'];
  
  const rows = finalBookings.map(b => {
    let safeTotal = b.totalAmount;
    
    if (!safeTotal) {
      let hour = parseInt((b.time || "00").split(':')[0]);
      let rate = hour < 12 ? 200 : 300;
      let duration = b.duration || 1;
      let addons = ((b.addons?.paddle || 0) * 30) + ((b.addons?.ball || 0) * 100);
      safeTotal = (rate * duration) + addons;
    }
    
    totalEarnings += safeTotal;
    
    return [
      b.id, b.date, b.time, b.court, b.name, b.email, b.mobile, b.payment,
      b.addons?.paddle || 0, b.addons?.ball || 0, safeTotal, b.status || 'confirmed'
    ];
  });
  
  rows.push([]);
  rows.push(['TOTAL EARNINGS', '', '', '', '', '', '', '', '', '', `PHP ${totalEarnings}`, '']);
  
  const csvContent = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hiraya-bookings-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
  
  const exportOptions = document.getElementById('exportOptions');
  if (exportOptions) exportOptions.classList.add('hidden');
}

async function exportToPDF() {
  if (!window.jspdf) {
    alert('PDF library is loading. Please try again in a moment.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const db = await getBookings();
  const filteredBookings = db.filter(b => b.status !== 'cancelled');
  
  // ✅ GROUP BY ID to prevent duplicate rows for multi-hour bookings
  const uniqueBookings = {};
  filteredBookings.forEach(b => {
    if (!uniqueBookings[b.id]) uniqueBookings[b.id] = b;
  });
  const finalBookings = Object.values(uniqueBookings);

  let totalEarnings = 0;
  
  // Title
  doc.setFontSize(20);
  doc.setTextColor(53, 6, 62);
  doc.text('HIRAYA PICKLEBALL', 14, 20);
  
  doc.setFontSize(16);
  doc.setTextColor(100, 100, 100);
  doc.text('Booking Report', 14, 30);
  
  doc.setFontSize(10);
  doc.setTextColor(150, 150, 150);
  doc.text(`Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`, 14, 38);
  
  // Summary
  doc.setFontSize(12);
  doc.setTextColor(53, 6, 62);
  doc.text(`Total Bookings: ${finalBookings.length}`, 14, 50);
  
  // Table Data
  const tableColumn = ['ID', 'Date', 'Time', 'Court', 'Customer', 'Payment', 'Total', 'Status'];
  
  const tableRows = finalBookings.map(booking => {
    let safeTotal = booking.totalAmount;
    
    if (!safeTotal) {
      let hour = parseInt((booking.time || "00").split(':')[0]);
      let rate = hour < 12 ? 200 : 300;
      let duration = booking.duration || 1;
      let addons = ((booking.addons?.paddle || 0) * 30) + ((booking.addons?.ball || 0) * 100);
      safeTotal = (rate * duration) + addons;
    }
    
    totalEarnings += safeTotal;
    
    return [
      booking.id,
      booking.date,
      formatTime12(booking.time),
      booking.court,
      booking.name,
      booking.payment.toUpperCase(),
      `PHP ${safeTotal}`,
      (booking.status || 'confirmed').toUpperCase()
    ];
  });
  
  doc.text(`Total Earnings: PHP ${totalEarnings}`, 14, 58);
  
  // Generate Table
  doc.autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 66,
    theme: 'striped',
    headStyles: { 
      fillColor: [53, 6, 62],
      textColor: 255,
      fontStyle: 'bold'
    },
    alternateRowStyles: {
      fillColor: [245, 245, 245]
    }
  });
  
  // Footer Page Numbers
  const pageCount = doc.internal.getNumberOfPages();
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.setFont(undefined, 'normal');
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.text(`Page ${i} of ${pageCount}`, 14, 285);
  }
  
  // Save PDF
  doc.save(`hiraya-bookings-${new Date().toISOString().split('T')[0]}.pdf`);
  
  const exportOptions = document.getElementById('exportOptions');
  if (exportOptions) exportOptions.classList.add('hidden');
}

  // ==========================================
// EDIT BOOKING FUNCTIONS
// ==========================================

async function openEditModal(id) {
  const db = await getBookings();

  // Get all records for this booking
  const bookings = db.filter(b => b.bookingId === id);

  if (bookings.length === 0) {
    console.error('Booking not found:', id);
    return;
  }

  const first = bookings[0];
  const duration = bookings.length;

  function updateEditTotal() {
    const duration = parseInt(document.getElementById('editDuration').value) || 1;
    const paddleQty = parseInt(document.getElementById('editPaddleQty').value) || 0;
    const ballQty = parseInt(document.getElementById('editBallQty').value) || 0;

    const total = calculateBookingTotal(first);

    document.getElementById('editTotalAmount').textContent = `₱${total}`;
    document.getElementById('editDurationDisplay').textContent = duration;
  }

  // Populate Modal
  document.getElementById('editBookingId').value = id;
  document.getElementById('editDate').value = first.date;
  document.getElementById('editCourt').value = first.court;
  document.getElementById('editDuration').value = duration;
  document.getElementById('editPaddleQty').value = first.addons?.paddle || 0;
  document.getElementById('editBallQty').value = first.addons?.ball || 0;
  document.getElementById('editStatus').value = first.status || 'confirmed';

  // Populate Time Dropdown
  const timeSelect = document.getElementById('editTime');
  timeSelect.innerHTML = '';
  const times = ["06:00", "07:00", "08:00", "09:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00"];
  times.forEach(t => {
    const option = document.createElement('option');
    option.value = t;
    option.textContent = formatTime12(t);
    if (t === first.time) option.selected = true;
    timeSelect.appendChild(option);
  });

    // ... (rest of the function)
  
  // Update the total display
  updateEditTotal();
  
  document.getElementById('editBookingModal').classList.remove('hidden');
}
  

function closeEditModal() {
  document.getElementById('editBookingModal').classList.add('hidden');
}

async function saveEditedBooking() {
  const id = document.getElementById('editBookingId').value;
  const newDate = document.getElementById('editDate').value;
  const newTime = document.getElementById('editTime').value;
  const newCourt = document.getElementById('editCourt').value;
  const newDuration = parseInt(document.getElementById('editDuration').value) || 1;
  const newPaddle = parseInt(document.getElementById('editPaddleQty').value) || 0;
  const newBall = parseInt(document.getElementById('editBallQty').value) || 0;
  const newStatus = document.getElementById('editStatus').value;

  if (!newDate) {
    alert('Please select a date.');
    return;
  }

  if (!newTime) {
    alert('Please select a start time.');
    return;
  }

  try {
    // ==========================================
    // GET BOOKINGS FROM FIREBASE
    // ==========================================
    const db = await getBookings();

    // Find ALL hourly records for this booking
    const currentBookings = db.filter(b => b.bookingId === id);

    if (currentBookings.length === 0) {
      alert('Booking not found.');
      console.error('Could not find booking:', id);
      return;
    }

    // Keep the original customer information
    const originalBooking = currentBookings[0];

    // Firebase functions
    const {
      collection,
      getDocs,
      query,
      where,
      addDoc,
      deleteDoc,
      doc
    } = window.firebaseFunctions;

    // ==========================================
    // CHECK AVAILABILITY
    // ==========================================
    const startHour = parseInt(newTime.split(':')[0]);

    for (let i = 0; i < newDuration; i++) {
      const checkHour = startHour + i;
      const checkTimeStr =
        `${checkHour.toString().padStart(2, '0')}:00`;

      const isBooked = db.some(b =>
        b.bookingId !== id &&
        b.date === newDate &&
        b.court === newCourt &&
        b.time === checkTimeStr &&
        b.status !== 'cancelled'
      );

      if (isBooked) {
        alert(
          `Sorry, ${formatTime12(checkTimeStr)} on ${newDate} at ${newCourt} is already booked.`
        );
        return;
      }
    }

    // ==========================================
    // FIND OLD FIRESTORE DOCUMENTS
    // ==========================================
    const q = query(
      collection(window.db, 'bookings'),
      where('bookingId', '==', id)
    );

    const snapshot = await getDocs(q);

    console.log(`Found ${snapshot.docs.length} old records to replace.`);

    // ==========================================
    // DELETE OLD RECORDS
    // ==========================================
    await Promise.all(
      snapshot.docs.map(document =>
        deleteDoc(
          doc(window.db, 'bookings', document.id)
        )
      )
    );

    console.log('Old booking records deleted.');

    // ==========================================
    // CREATE NEW RECORDS
    // ==========================================
    for (let i = 0; i < newDuration; i++) {
      const currentHour = startHour + i;

      const currentTimeStr =
        `${currentHour.toString().padStart(2, '0')}:00`;

      const payload = {
        bookingId: id,
        date: newDate,
        time: currentTimeStr,
        court: newCourt,

        // Customer information
        name: originalBooking.name,
        mobile: originalBooking.mobile,
        email: originalBooking.email,
        payment: originalBooking.payment,

        // Add-ons
        addons: {
          paddle: newPaddle,
          ball: newBall
        },

        // Booking information
        duration: newDuration,
        status: newStatus
      };

      await addDoc(
        collection(window.db, 'bookings'),
        payload
      );
    }

    console.log('New booking records created.');

    // ==========================================
    // SUCCESS
    // ==========================================
    alert('Booking updated successfully!');

    closeEditModal();

    // Reload admin table
    await loadAdminData();

  } catch (error) {
    console.error('❌ Error updating booking:', error);
    alert(
      'Failed to update booking.\n\nCheck the browser console for details.'
    );
  }
}

// Live total calculation for Edit Modal
function updateEditTotal() {
  const duration = parseInt(document.getElementById('editDuration').value) || 1;
  const paddleQty = parseInt(document.getElementById('editPaddleQty').value) || 0;
  const ballQty = parseInt(document.getElementById('editBallQty').value) || 0;
  const editTime = document.getElementById('editTime').value;
  
  // Dynamic AM/PM Rate for Edit Modal
  let hourlyRate = 300;
  const hour = parseInt(editTime.split(':')[0]);
  if (hour < 12) {
    hourlyRate = 200; // AM Rate
  }
  
  const courtPrice = hourlyRate * duration;
  const addonsPrice = (paddleQty * 30) + (ballQty * 100);
  const total = courtPrice + addonsPrice;
  
  document.getElementById('editTotalAmount').textContent = `₱${total}`;
  document.getElementById('editDurationDisplay').textContent = duration;
  
  // 👇 ADD THIS LINE 👇
  document.getElementById('editCourtRateDisplay').textContent = `₱${hourlyRate}`;
}

// ==========================================
// EMAIL NOTIFICATION FUNCTIONS (EmailJS)
// ==========================================

// 1. Notify Admin when a NEW booking is made (Customer is NOT notified yet)
async function notifyAdminOfNewBooking(bookingData) {
  const { id, date, time, court, duration, name, email, mobile, payment, addons, status } = bookingData;
  // ✅ Use the saved totalAmount, or fallback to our smart calculator
  const total = bookingData.totalAmount || calculateBookingTotal(bookingData);
  
  const startHour = parseInt(time.split(':')[0]);
  const endHour = startHour + duration;
  const endTimeStr = `${endHour.toString().padStart(2, '0')}:00`;
  const timeRange = `${formatTime12(time)} - ${formatTime12(endTimeStr)}`;

  const adminParams = {
    booking_id: id,
    customer_name: name,
    customer_email: email,
    customer_mobile: mobile,
    booking_date: date,
    booking_time: timeRange,
    court: court,
    duration: duration,
    payment_method: payment.toUpperCase(),
    total_amount: total,
    status: status,
    to_email: 'vincintjude7@gmail.com', // <-- Your admin email
    to_name: 'Hiraya Admin'
  };

  try {
    await emailjs.send('service_i5zradf', 'template_oh45oeb', adminParams);
    console.log('✅ Admin notification email sent successfully!');
  } catch (error) {
    console.error('❌ Failed to send admin email:', error);
  }
}

// 2. Notify Customer ONLY when Admin clicks "Confirm"
async function notifyCustomerOfConfirmation(bookingData) {
  const { id, date, time, court, duration, name, email, mobile, payment, addons, status } = bookingData;
  // ✅ Use the saved totalAmount, or fallback to our smart calculator
  const total = bookingData.totalAmount || calculateBookingTotal(bookingData);
  
  const startHour = parseInt(time.split(':')[0]);
  const endHour = startHour + duration;
  const endTimeStr = `${endHour.toString().padStart(2, '0')}:00`;
  const timeRange = `${formatTime12(time)} - ${formatTime12(endTimeStr)}`;

  const customerParams = {
    booking_id: id,
    customer_name: name,
    booking_date: date,
    booking_time: timeRange,
    court: court,
    duration: duration,
    total_amount: total,
    to_email: email, 
    to_name: name
  };

  try {
    if (customerParams.to_email && customerParams.to_email.includes('@')) {
      await emailjs.send('service_i5zradf', 'template_hra91so', customerParams);
      console.log('✅ Customer confirmation email sent successfully!');
    } else {
      console.warn('⚠️ Customer email skipped: Invalid email address.');
    }
  } catch (error) {
    console.error('❌ Failed to send customer email:', error);
  }
}

// ==========================================
// DYNAMIC PRICING: AM/PM RATES (FINAL CLEAN VERSION)
// ==========================================

const RATE_AM = 200;
const RATE_PM = 300;

function isAM(timeStr) {
  if (!timeStr) return true;
  const hour = parseInt(timeStr.split(':')[0]);
  return hour < 12;
}

// Universal calculator for Admin Dashboard, Emails, and Exports
function calculateBookingTotal(data) {
  // 1. If the booking already has a saved totalAmount, trust it!
  if (data.totalAmount) {
    return data.totalAmount;
  }

  // 2. Fallback: Calculate dynamically
  let hourlyRate = isAM(data.time) ? RATE_AM : RATE_PM;
  const duration = data.duration || 1;
  const courtPrice = hourlyRate * duration;
  const addonsPrice = ((data.addons?.paddle || 0) * 30) + ((data.addons?.ball || 0) * 100);
  
  return courtPrice + addonsPrice;
}

// Form calculator for the Customer Booking Page
function updateFormTotal() {
  // 🛡️ SAFETY GUARD: If we are NOT on the booking page, STOP immediately.
  const durationEl = document.getElementById('bookingDuration');
  if (!durationEl) return; 

  const hiddenTimeEl = document.getElementById('hiddenTime');
  if (!hiddenTimeEl) return;

  const paddleQtyEl = document.getElementById('paddleQty');
  const ballQtyEl = document.getElementById('ballQty');
  const addonsDisplay = document.getElementById('addonsPriceDisplay');
  const totalDisplay = document.getElementById('grandTotalDisplay');

  const duration = parseInt(durationEl.value) || 1;
  const paddleQty = parseInt(paddleQtyEl ? paddleQtyEl.textContent : 0) || 0;
  const ballQty = parseInt(ballQtyEl ? ballQtyEl.textContent : 0) || 0;
  const selectedTime = hiddenTimeEl.value;

  let courtPrice = 0;
  if (selectedTime) {
    const hourlyRate = isAM(selectedTime) ? RATE_AM : RATE_PM;
    courtPrice = hourlyRate * duration;
  }

  const addonsPrice = (paddleQty * 30) + (ballQty * 100);
  const total = courtPrice + addonsPrice;

  if (addonsDisplay) addonsDisplay.textContent = `₱${addonsPrice}`;
  if (totalDisplay) totalDisplay.textContent = `₱${total}`;
}

// Ensure totals update when page loads or duration changes
document.addEventListener('DOMContentLoaded', () => {
  updateFormTotal();
  
  const durationSelect = document.getElementById('bookingDuration');
  if (durationSelect) {
    durationSelect.addEventListener('change', updateFormTotal);
  }

  // Update total when add-ons change
  document.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(updateFormTotal, 100);


      
    });
  });

  // ==========================================
  // FLOATING NAVIGATION LOGIC
  // ==========================================

  
  const floatingNav = document.getElementById('floatingNav');
  const backToTopBtn = document.getElementById('backToTopBtn');

  if (floatingNav && backToTopBtn) {
    
    // Show/hide based on scroll position (Smooth Fade)
    window.addEventListener('scroll', () => {
      if (window.scrollY > 400) {
        floatingNav.classList.add('visible');
      } else {
        floatingNav.classList.remove('visible');
      }
    });

    // Smooth scroll to top
    backToTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    
    // Smooth scroll for navigation dots
    document.querySelectorAll('.nav-dot[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function(e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      });
    });
  }

  

});

// ==========================================
// UNIVERSAL BOOKING TOTAL CALCULATOR
// ==========================================
function calculateBookingTotal(data) {
  // 1. If the booking already has a saved totalAmount, trust it!
  if (data.totalAmount) {
    return data.totalAmount;
  }

  // 2. Fallback: Calculate dynamically for older bookings or email data
  let hourlyRate = 300; // Default PM
  const timeLower = (data.time || "").toLowerCase();
  const hour = parseInt((data.time || "00:00").split(':')[0]);
  
  if ((timeLower.includes('am') && !timeLower.includes('12:00')) || (hour < 12 && !timeLower.includes('pm'))) {
    hourlyRate = 200; // AM Rate
  }

  const duration = data.duration || 1;
  const courtPrice = hourlyRate * duration;
  const paddleQty = data.addons?.paddle || 0;
  const ballQty = data.addons?.ball || 0;
  const addonsPrice = (paddleQty * 30) + (ballQty * 100);
  
  return courtPrice + addonsPrice;
}

// Function to get current rate based on selected time
function getCurrentRate() {
  const hiddenTime = document.getElementById('hiddenTime');
  const selectedSlot = document.getElementById('selectedSlotDisplay');
  
  if (hiddenTime && hiddenTime.value) {
    return isAM(hiddenTime.value) ? RATE_AM : RATE_PM;
  }
  
  if (selectedSlot && selectedSlot.value) {
    return isAM(selectedSlot.value) ? RATE_AM : RATE_PM;
  }
  
  // Default to AM rate if nothing selected
  return RATE_AM;
}

// Function to update rate display based on filter
function updateRateDisplay() {
  const amDisplay = document.getElementById('amRateDisplay');
  const pmDisplay = document.getElementById('pmRateDisplay');
  const activeFilter = document.querySelector('.filter-btn.active');
  
  if (!amDisplay || !pmDisplay) return;
  
  if (activeFilter && activeFilter.dataset.filter === 'pm') {
    amDisplay.classList.remove('active');
    pmDisplay.classList.add('active');
  } else {
    amDisplay.classList.add('active');
    pmDisplay.classList.remove('active');
  }
}

// Update the booking total calculation
function updateBookingTotal() {
  const duration = parseInt(document.getElementById('bookingDuration')?.value || 1);
  const paddleQty = parseInt(document.getElementById('paddleQty')?.textContent || 0);
  const ballQty = parseInt(document.getElementById('ballQty')?.textContent || 0);
  
  // Get the correct rate based on the selected time
  const hourlyRate = getCurrentRate();
  const courtPrice = hourlyRate * duration;
  const addonsPrice = (paddleQty * 30) + (ballQty * 100);
  const total = courtPrice + addonsPrice;
  
  // Update displays
  const addonsDisplay = document.getElementById('addonsPriceDisplay');
  const totalDisplay = document.getElementById('grandTotalDisplay');
  
  if (addonsDisplay) addonsDisplay.textContent = `₱${addonsPrice}`;
  if (totalDisplay) totalDisplay.textContent = `₱${total}`;
  
  // Also update the review modal if it exists
  const revTotal = document.getElementById('rev-total');
  if (revTotal) revTotal.textContent = `₱${total}`;
  
  return total;
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Add event listeners to filter buttons
  const filterButtons = document.querySelectorAll('.filter-btn');
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(() => {
        updateRateDisplay();
      }, 100);
    });
  });
  
  // Update total when duration changes
  const durationSelect = document.getElementById('bookingDuration');
  if (durationSelect) {
    durationSelect.addEventListener('change', updateBookingTotal);
  }
  
  // Update total when add-ons change (this should already exist in your code)
  const qtyButtons = document.querySelectorAll('.qty-btn');
  qtyButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      setTimeout(() => {
        updateBookingTotal();
      }, 100);
    });
  });
});



// Add event listeners for real-time updates
document.addEventListener('DOMContentLoaded', () => {
  // Update total when duration changes
  const durationSelect = document.getElementById('bookingDuration');
  if (durationSelect) {
    durationSelect.addEventListener('change', updateBookingTotal);
  }
  
  // Update total when add-ons change
  const paddleQtyEl = document.getElementById('paddleQty');
  const ballQtyEl = document.getElementById('ballQty');
  
  if (paddleQtyEl && ballQtyEl) {
    // The existing +/- buttons should already trigger updates
    // This ensures the total updates correctly
  }
});