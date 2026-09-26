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
      await waitForFirebase();

      if (!window.db) {
        throw new Error("Firebase failed to load");
      }

      const {
        collection,
        doc,
        writeBatch
      } = window.firebaseFunctions;

      if (!writeBatch) {
        throw new Error("Firestore writeBatch is not available");
      }

      const batch = writeBatch(window.db);
      const bookingsCollection = collection(window.db, "bookings");

      bookingDataArray.forEach(data => {
        const newBookingRef = doc(bookingsCollection);
        batch.set(newBookingRef, data);
      });

      await batch.commit();
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
      "06:00", "07:00", "08:00", "09:00", "10:00", "11:00",
      "12:00", "13:00", "14:00", "15:00", "16:00", "17:00",
      "18:00", "19:00", "20:00", "21:00"
    ];
    const COURTS = ['Court 1', 'Court 2'];

    // Admin bookings pagination
    let currentPage = 1;
    const itemsPerPage = 10;
    // Global variables for add-on quantities
    let paddleQty = 0;
    let ballQty = 0;

    // ==========================================
    // HELPER FUNCTIONS
    // ==========================================
    let currentWeekOffset = 0;
    let selectedCalendarDate = null;


    // ==========================================
    // OPEN PLAY RULES + DATE/COURT OVERRIDES
    // ==========================================
    // Weekly defaults:
    // Mon-Thu: Court 1 Open Play from 8:00 PM; Court 2 from 5:00 PM.
    // Friday: both courts are Open Play all day.
    // Sat-Sun: both courts are Open Play from 6:00 PM.
    //
    // Admin date overrides in Firestore collection "openPlayOverrides"
    // can force a specific court/date to either "open-play" or "bookable".
    // Overrides affect Open Play only; maintenance/event closures still win.
    // ==========================================
    function getDayNumber(dateStr) {
      if (!dateStr) return -1;
      const date = new Date(`${dateStr}T00:00:00`);
      return Number.isNaN(date.getTime()) ? -1 : date.getDay();
    }

    async function getOpenPlayOverrides() {
      try {
        await waitForFirebase();

        if (!window.db || !window.firebaseFunctions) {
          return [];
        }

        const { collection, getDocs } = window.firebaseFunctions;
        const snapshot = await getDocs(
          collection(window.db, 'openPlayOverrides')
        );

        return snapshot.docs.map(document => ({
          id: document.id,
          ...document.data()
        }));
      } catch (error) {
        console.error('Error loading Open Play overrides:', error);
        return [];
      }
    }

    function findOpenPlayOverride(dateStr, court, overrides = []) {
      return overrides.find(override =>
        override.date === dateStr &&
        (override.court === court || override.court === 'All')
      ) || null;
    }

    function isRecurringOpenPlaySlot(dateStr, timeStr, court) {
      if (!dateStr || !timeStr || !court) return false;

      const dayNumber = getDayNumber(dateStr);
      const hour = parseInt(timeStr.split(':')[0], 10);

      if (Number.isNaN(hour)) return false;

      // Friday: Open Play all day on both courts.
      if (dayNumber === 5) {
        return true;
      }

      // Saturday + Sunday: Open Play from 6:00 PM onwards.
      if (dayNumber === 6 || dayNumber === 0) {
        return hour >= 18;
      }

      // Monday through Thursday.
      if (dayNumber >= 1 && dayNumber <= 4) {
        if (court === 'Court 1') {
          // Last bookable block is 7:00 PM-8:00 PM.
          return hour >= 20;
        }

        if (court === 'Court 2') {
          // Last bookable block is 4:00 PM-5:00 PM.
          return hour >= 17;
        }
      }

      return false;
    }

    function isOpenPlaySlot(dateStr, timeStr, court, overrides = []) {
      const manualOverride =
        findOpenPlayOverride(dateStr, court, overrides);

      if (manualOverride?.mode === 'open-play') {
        return true;
      }

      if (manualOverride?.mode === 'bookable') {
        return false;
      }

      return isRecurringOpenPlaySlot(dateStr, timeStr, court);
    }

    function getOpenPlayRestrictionMessage(dateStr, timeStr, court, overrides = []) {
      const override =
        findOpenPlayOverride(dateStr, court, overrides);

      if (override?.mode === 'open-play') {
        return `${court} on ${dateStr} has been set to Open Play by the admin.`;
      }

      const dayNumber = getDayNumber(dateStr);

      if (dayNumber === 5) {
        return `Fridays are Open Play all day on both courts.`;
      }

      if (dayNumber === 6 || dayNumber === 0) {
        return `Saturday and Sunday are Open Play from 6:00 PM onwards.`;
      }

      if (dayNumber >= 1 && dayNumber <= 4) {
        if (court === 'Court 1') {
          return `Monday to Thursday, Court 1 is Open Play from 8:00 PM onwards.`;
        }

        if (court === 'Court 2') {
          return `Monday to Thursday, Court 2 is Open Play from 5:00 PM onwards.`;
        }
      }

      return `${court} is reserved for Open Play at ${formatTime12(timeStr)}.`;
    }

    async function validateOpenPlayRestriction(
      dateStr,
      startTimeStr,
      duration,
      court
    ) {
      if (!dateStr || !startTimeStr || !duration || !court) {
        return {
          allowed: false,
          message: 'Please select a valid date, time, court, and duration.'
        };
      }

      const startHour = parseInt(startTimeStr.split(':')[0], 10);
      const safeDuration = Math.max(1, parseInt(duration, 10) || 1);
      const overrides = await getOpenPlayOverrides();

      for (let i = 0; i < safeDuration; i++) {
        const currentHour = startHour + i;
        const currentTime =
          `${currentHour.toString().padStart(2, '0')}:00`;

        if (!TIME_SLOTS.includes(currentTime)) {
          return {
            allowed: false,
            message:
              `That duration extends beyond the available court schedule. ` +
              `Please choose a shorter duration.`
          };
        }

        if (
          isOpenPlaySlot(
            dateStr,
            currentTime,
            court,
            overrides
          )
        ) {
          return {
            allowed: false,
            message:
              `${getOpenPlayRestrictionMessage(
                dateStr,
                currentTime,
                court,
                overrides
              )}\n\nPlease choose another available time or court.`
          };
        }
      }

      return {
        allowed: true,
        endHour: startHour + safeDuration
      };
    }

    async function updateDurationOptionsForOpenPlay(
      dateStr,
      startTimeStr,
      court
    ) {
      const durationSelect =
        document.getElementById('bookingDuration');

      if (
        !durationSelect ||
        !dateStr ||
        !startTimeStr ||
        !court
      ) {
        return;
      }

      const startHour = parseInt(startTimeStr.split(':')[0], 10);
      const overrides = await getOpenPlayOverrides();

      Array.from(durationSelect.options).forEach(option => {
        const duration =
          Math.max(1, parseInt(option.value, 10) || 1);

        let invalid = false;

        for (let i = 0; i < duration; i++) {
          const currentHour = startHour + i;
          const currentTime =
            `${currentHour.toString().padStart(2, '0')}:00`;

          if (
            !TIME_SLOTS.includes(currentTime) ||
            isOpenPlaySlot(
              dateStr,
              currentTime,
              court,
              overrides
            )
          ) {
            invalid = true;
            break;
          }
        }

        option.disabled = invalid;
      });

      const selectedOption =
        durationSelect.options[durationSelect.selectedIndex];

      if (selectedOption?.disabled) {
        const firstAllowed =
          Array.from(durationSelect.options)
            .find(option => !option.disabled);

        if (firstAllowed) {
          durationSelect.value = firstAllowed.value;
        }
      }

      updateFormTotal();
    }

    // ==========================================
    // WEEK NAVIGATION BUTTONS
    // ==========================================
    document.addEventListener('DOMContentLoaded', () => {

      const prevWeekBtn = document.getElementById('prevWeekBtn');
      const nextWeekBtn = document.getElementById('nextWeekBtn');
      const weekCurrentLabel = document.getElementById('weekCurrentLabel');

      function updateWeekNavigation() {

        // Disable previous week when already on current week
        if (prevWeekBtn) {
          prevWeekBtn.disabled = currentWeekOffset <= 0;
        }

        // Update week label
        if (weekCurrentLabel) {
          const dates = getWeekDates();

          const firstDate = dates[0].dateObj;
          const lastDate = dates[6].dateObj;

          const options = {
            month: 'short',
            day: 'numeric'
          };

          weekCurrentLabel.textContent =
            `${firstDate.toLocaleDateString('en-US', options)} - ` +
            `${lastDate.toLocaleDateString('en-US', options)}`;
        }
      }

    // PREVIOUS WEEK
    if (prevWeekBtn) {
      prevWeekBtn.addEventListener('click', async () => {

        if (currentWeekOffset > 0) {
          currentWeekOffset--;
          selectedCalendarDate = null;

          console.log('⬅️ Week offset:', currentWeekOffset);
          console.log(
            '⬅️ Week dates:',
            getWeekDates().map(d => d.dateStr)
          );

          await renderCalendar();
          await window.renderMobileSchedule();

          updateWeekNavigation();
        }

      });
    }

    // NEXT WEEK
    if (nextWeekBtn) {
      nextWeekBtn.addEventListener('click', async () => {

        currentWeekOffset++;
        selectedCalendarDate = null;

        console.log('➡️ Week offset:', currentWeekOffset);
        console.log(
          '➡️ Week dates:',
          getWeekDates().map(d => d.dateStr)
        );

        await renderCalendar();
        await window.renderMobileSchedule();

        updateWeekNavigation();
      });
    }

    updateWeekNavigation();

    });

    function getWeekDates() {
      const dates = [];

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Start from Sunday of the current week
      const sunday = new Date(today);
      sunday.setDate(today.getDate() - today.getDay());

      // Move to selected week
      sunday.setDate(sunday.getDate() + (currentWeekOffset * 7));

      for (let i = 0; i < 7; i++) {
        const day = new Date(sunday);
        day.setDate(sunday.getDate() + i);

        dates.push({
          dateObj: new Date(day),

          dateStr:
            day.getFullYear() + '-' +
            String(day.getMonth() + 1).padStart(2, '0') + '-' +
            String(day.getDate()).padStart(2, '0'),

          dayName: day
            .toLocaleDateString('en-US', { weekday: 'short' })
            .toUpperCase(),

          dayNum: day.getDate(),

          isToday:
            day.toDateString() === today.toDateString(),

          isPast: day < today
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
      const slotDate = new Date(`${dateStr}T${timeStr}:00`);

      return slotDate < now;
    }


    function getCalendarTimeSlots() {
      // Show every configured court hour in one continuous calendar.
      return TIME_SLOTS;
    }

    // Form calculator for the Customer Booking Page (Safe for Admin Page too)
    function updateFormTotal() {
      const durationEl = document.getElementById('bookingDuration');
      const hiddenTimeEl = document.getElementById('hiddenTime');

      if (!durationEl || !hiddenTimeEl) return;

      const paddleQtyEl = document.getElementById('paddleQty');
      const ballQtyEl = document.getElementById('ballQty');
      const addonsDisplay = document.getElementById('addonsPriceDisplay');
      const totalDisplay = document.getElementById('grandTotalDisplay');

      const duration = parseInt(durationEl.value) || 1;
      const paddleQty = parseInt(paddleQtyEl?.textContent) || 0;
      const ballQty = parseInt(ballQtyEl?.textContent) || 0;
      const selectedTime = hiddenTimeEl.value;

      const addonsPrice = (paddleQty * 30) + (ballQty * 100);

      const total = selectedTime
        ? calculateBookingTotal({
            time: selectedTime,
            duration,
            addons: { paddle: paddleQty, ball: ballQty }
          })
        : addonsPrice;

      if (addonsDisplay) addonsDisplay.textContent = `₱${addonsPrice}`;
      if (totalDisplay) totalDisplay.textContent = `₱${total}`;

      const revTotal = document.getElementById('rev-total');
      if (revTotal) revTotal.textContent = `₱${total}`;

      return total;
    }
    // ==========================================
    // CALENDAR RENDERING
    // ==========================================
    function getCourtroomSlotState({ day, time, court, db, settings, closures, overrides }) {
      const booking = db.find(b =>
        b.date === day.dateStr &&
        b.court === court &&
        b.time === time &&
        b.status !== 'cancelled'
      );

      const scheduledClosure = closures.find(c =>
        c.date === day.dateStr &&
        (c.court === court || c.court === 'All')
      );

      if (day.isPast || isSlotInPast(day.dateStr, time)) {
        return { statusClass: 'past', statusText: 'Past', clickable: false };
      }

      if (scheduledClosure) {
        if (scheduledClosure.reason === 'tournament') {
          return { statusClass: 'tournament', statusText: 'Event', clickable: false };
        }

        if (scheduledClosure.reason === 'maintenance') {
          return { statusClass: 'maintenance', statusText: 'Maintenance', clickable: false };
        }

        return { statusClass: 'closed', statusText: 'Closed', clickable: false };
      }

      if (settings?.facilityStatus === 'closed') {
        return { statusClass: 'closed', statusText: 'Closed', clickable: false };
      }

      const courtStatus = settings?.courts?.[court] || 'open';

      if (courtStatus === 'maintenance') {
        return { statusClass: 'maintenance', statusText: 'Maintenance', clickable: false };
      }

      if (courtStatus === 'tournament' || courtStatus === 'event') {
        return { statusClass: 'tournament', statusText: 'Event', clickable: false };
      }

      if (courtStatus === 'closed') {
        return { statusClass: 'closed', statusText: 'Closed', clickable: false };
      }

      // Honor existing reservations even if a later Open Play rule/override
      // would otherwise cover the same slot.
      if (booking) {
        if (booking.status === 'pending') {
          return { statusClass: 'pending', statusText: 'Pending', clickable: false };
        }

        return { statusClass: 'booked', statusText: 'Booked', clickable: false };
      }

      if (isOpenPlaySlot(day.dateStr, time, court, overrides)) {
        return { statusClass: 'open-play', statusText: 'Open Play', clickable: false };
      }

      return { statusClass: 'open', statusText: 'Available', clickable: true };
    }

    async function renderCalendar() {
      const grid = document.getElementById('calendarGrid');
      const dateTabs = document.getElementById('courtroomDateTabs');
      if (!grid || !dateTabs) return;

      const weekDates = getWeekDates();
      const calendarTimes = getCalendarTimeSlots();

      if (!selectedCalendarDate || !weekDates.some(day => day.dateStr === selectedCalendarDate)) {
        const today = weekDates.find(day => day.isToday);
        selectedCalendarDate = (today || weekDates[0])?.dateStr || null;
      }

      dateTabs.innerHTML = weekDates.map(day => {
        const isSelected = day.dateStr === selectedCalendarDate;
        const label = day.isToday
          ? 'Today'
          : day.dayName.charAt(0) + day.dayName.slice(1).toLowerCase();

        return `
          <button
            type="button"
            class="courtroom-date-tab ${isSelected ? 'active' : ''} ${day.isToday ? 'today' : ''}"
            onclick="selectCalendarDay('${day.dateStr}')"
            aria-pressed="${isSelected}"
          >
            <span class="courtroom-date-day">${label}</span>
            <span class="courtroom-date-number">${day.dayNum}</span>
          </button>
        `;
      }).join('');

      const selectedDay = weekDates.find(day => day.dateStr === selectedCalendarDate) || weekDates[0];

      grid.innerHTML = '<p class="loading-text courtroom-loading">Loading schedule...</p>';

      const [db, settings, overrides] = await Promise.all([
        getBookings(),
        getFacilitySettingsFromFirestore(),
        getOpenPlayOverrides()
      ]);

      let closures = [];

      try {
        await waitForFirebase();

        if (window.db && window.firebaseFunctions) {
          const { collection, getDocs } = window.firebaseFunctions;
          const closuresSnapshot = await getDocs(collection(window.db, 'scheduledClosures'));

          closures = closuresSnapshot.docs.map(document => ({
            id: document.id,
            ...document.data()
          }));
        }
      } catch (error) {
        console.error('Error loading scheduled closures:', error);
        closures = [];
      }

      let html = `
        <div class="courtroom-table-head courtroom-table-row">
          <div class="courtroom-time-head">Time</div>
          ${COURTS.map(court => `
            <div class="courtroom-court-head">
              <strong>${court}</strong>
            
            </div>
          `).join('')}
        </div>
      `;

      for (const time of calendarTimes) {
        html += `<div class="courtroom-table-row courtroom-time-row">`;
        html += `<div class="courtroom-time-cell">${formatTime12(time).toUpperCase()}</div>`;

        for (const court of COURTS) {
          const slotState = getCourtroomSlotState({
            day: selectedDay,
            time,
            court,
            db,
            settings,
            closures,
            overrides
          });

          const clickAction = slotState.clickable
            ? `onclick="selectSlot('${selectedDay.dateStr}', '${time}', '${court}')"`
            : '';

          const disabledAttr = slotState.clickable ? '' : 'disabled';

          html += `
            <div class="courtroom-slot-cell">
              <button
                type="button"
                class="courtroom-slot ${slotState.statusClass}"
                ${clickAction}
                ${disabledAttr}
              >
                ${slotState.statusText}
              </button>
            </div>
          `;
        }

        html += `</div>`;
      }

      if (!calendarTimes.length) {
        html += `<div class="courtroom-empty-state">No schedule slots available.</div>`;
      }

      grid.innerHTML = html;
    }

    window.selectCalendarDay = function(dateStr) {
      selectedCalendarDate = dateStr;
      renderCalendar();
    };

    function selectSlot(date, time, court) {
      document.getElementById('hiddenDate').value = date;
      document.getElementById('hiddenTime').value = time;
      document.getElementById('hiddenCourt').value = court;
      document.getElementById('selectedSlotDisplay').value = `${date} | ${formatTime12(time)} | ${court}`;
      document.querySelector('.booking-form-section').scrollIntoView({ behavior: 'smooth' });
      
      const clearSlotBtn = document.getElementById('clearSlotBtn');
      if (clearSlotBtn) clearSlotBtn.disabled = false;

      // Recalculate the total and restrict duration when Open Play applies.
      updateFormTotal();
      updateDurationOptionsForOpenPlay(date, time, court);
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
      

      // ==========================================
    // RESPONSIVE SCHEDULE COMPATIBILITY
    // ==========================================
    // The Courtroom-style schedule uses one responsive table for both
    // desktop and mobile. Keep this function because older event handlers
    // elsewhere in this file still call it.
    async function renderMobileSchedule() {
      return;
    }

    window.renderMobileSchedule = renderMobileSchedule;

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
        bookingForm.addEventListener('submit', async (e) => {
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

          // ==========================================
          // OPEN PLAY BOOKING RESTRICTIONS
          // ==========================================
          const selectedCourt = document.getElementById('hiddenCourt').value;
          const startHour = parseInt(startTimeStr.split(':')[0]);

          const openPlayCheck = await validateOpenPlayRestriction(
            date,
            startTimeStr,
            duration,
            selectedCourt
          );

          if (!openPlayCheck.allowed) {
            alert(openPlayCheck.message);
            return;
          }

          const paymentMethod = document.querySelector('input[name="payment"]:checked').value;
          const slotDisplay = document.getElementById('selectedSlotDisplay').value;
          
          const addonsText = [];
          if (paddleQty > 0) addonsText.push(`${paddleQty}x Paddle (₱${paddleQty * 30})`);
          if (ballQty > 0) addonsText.push(`${ballQty}x Ball (₱${ballQty * 100})`);
          const addonsDisplay = addonsText.length > 0 ? addonsText.join(', ') : 'None';

          const addonsPrice = (paddleQty * 30) + (ballQty * 100);
          const totalAmount = calculateBookingTotal({
            time: startTimeStr,
            duration,
            addons: { paddle: paddleQty, ball: ballQty }
          });

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

          const addonsTotal = (paddleQty * 30) + (ballQty * 100);
          const totalAmount = calculateBookingTotal({
            time: startTimeStr,
            duration,
            addons: { paddle: paddleQty, ball: ballQty }
          }); // Correct mixed-rate total

          const openPlayCheck = await validateOpenPlayRestriction(
            date,
            startTimeStr,
            duration,
            court
          );

          if (!openPlayCheck.allowed) {
            alert(openPlayCheck.message);
            closeReviewModal();
            return;
          }

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
          const bookingId =
      'HIRAYA-' +
      Date.now().toString().slice(-6) +
      '-' +
      Math.random().toString(36).substring(2, 6).toUpperCase();
          const status = 'pending'; 
          const bookingsToSave = [];

          for (let i = 0; i < duration; i++) {
            const currentHour = startHour + i;
            const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:00`;

           bookingsToSave.push({
      bookingId: bookingId,
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
      totalAmount: totalAmount,
      createdAt: Date.now()
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
      lookupBtn.addEventListener('click', async () => {
        const query = lookupInput.value.trim();

        if (!query) {
          alert('Please enter a Booking ID or Phone Number');
          return;
        }

        const db = await getBookings();
        const queryNumbersOnly = query.replace(/\D/g, '');

        // Get all ACTIVE records matching Booking ID or Phone Number
        const activeMatches = db.filter(b => {
          if (!b || b.status === 'cancelled') return false;

          const matchId = b.bookingId === query;
          const matchMobile = b.mobile === query;

          const matchMobileNumbersOnly =
            b.mobile &&
            b.mobile.replace(/\D/g, '') === queryNumbersOnly;

          return matchId || matchMobile || matchMobileNumbersOnly;
        });

        if (activeMatches.length > 0) {

          // ==========================================
          // GROUP RECORDS BY BOOKING ID
          // ==========================================
          const groupedBookings = {};

          activeMatches.forEach(b => {
            const key = b.bookingId || b.id;

            if (!groupedBookings[key]) {
              groupedBookings[key] = [];
            }

            groupedBookings[key].push(b);
          });

          let resultsHTML = '';

          Object.values(groupedBookings).forEach(bookings => {

            // Sort hourly records inside THIS booking only
            bookings.sort((a, b) => a.time.localeCompare(b.time));

            const firstBooking = bookings[0];
            const lastBooking = bookings[bookings.length - 1];

            const lastHour = parseInt(lastBooking.time.split(':')[0]);
            const endHour = lastHour + 1;

            const startTimeStr = formatTime12(firstBooking.time);

            const endTimeStr = formatTime12(
              `${endHour.toString().padStart(2, '0')}:00`
            );

            // Prefer saved duration, otherwise count hourly records
            const duration =
              parseInt(firstBooking.duration) || bookings.length;

            const addons =
              firstBooking.addons || { paddle: 0, ball: 0 };

            // Make sure total uses the full booking duration
            const total = calculateBookingTotal({
              ...firstBooking,
              duration: duration
            });

            let addonsText = 'None';

            if ((addons.paddle || 0) > 0 || (addons.ball || 0) > 0) {
              const addonList = [];

              if (addons.paddle > 0) {
                addonList.push(`${addons.paddle}x Paddle`);
              }

              if (addons.ball > 0) {
                addonList.push(`${addons.ball}x Ball`);
              }

              addonsText = addonList.join(', ');
            }

            resultsHTML += `
              <div style="
                background: white;
                padding: 20px;
                border-radius: 8px;
                border-left: 4px solid var(--success);
                margin-bottom: 16px;
              ">
                <h3 style="
                  margin-bottom: 16px;
                  color: var(--purple-dark);
                ">
                  ✓ Active Booking Found
                </h3>

                <div style="
                  display: grid;
                  gap: 12px;
                  font-size: 0.95rem;
                ">

                  <div>
                    <strong>Booking ID:</strong>
                    ${firstBooking.bookingId || 'N/A'}
                  </div>

                  <div>
                    <strong>Date:</strong>
                    ${firstBooking.date || 'N/A'}
                  </div>

                  <div>
                    <strong>Time:</strong>
                    ${startTimeStr} to ${endTimeStr}
                    <span style="
                      color: var(--purple-dark);
                      font-weight: 700;
                    ">
                      (${duration} Hour${duration > 1 ? 's' : ''})
                    </span>
                  </div>

                  <div>
                    <strong>Court:</strong>
                    ${firstBooking.court || 'N/A'}
                  </div>

                  <div>
                    <strong>Name:</strong>
                    ${firstBooking.name || 'N/A'}
                  </div>

                  <div>
                    <strong>Email:</strong>
                    ${firstBooking.email || 'N/A'}
                  </div>

                  <div>
                    <strong>Mobile:</strong>
                    ${firstBooking.mobile || 'N/A'}
                  </div>

                  <div>
                    <strong>Payment:</strong>
                    ${(firstBooking.payment || 'N/A').toUpperCase()}
                  </div>

                  <div>
                    <strong>Add-ons:</strong>
                    ${addonsText}
                  </div>

                  <div>
                    <strong>Total:</strong>
                    <span style="
                      color: var(--success);
                      font-weight: 700;
                      font-size: 1.1rem;
                    ">
                      ₱${total}
                    </span>
                  </div>

                  <div>
                    <strong>Status:</strong>
                    <span class="
                      status-badge
                      ${firstBooking.status || 'confirmed'}
                    ">
                      ${(firstBooking.status || 'confirmed').toUpperCase()}
                    </span>
                  </div>

                </div>

                <button
                  onclick="window.cancelBookingFunc('${firstBooking.bookingId}')"
                  style="
                    margin-top: 20px;
                    background: var(--danger);
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    border-radius: 6px;
                    font-weight: 600;
                    cursor: pointer;
                  "
                >
                  Cancel Booking
                </button>
              </div>
            `;
          });

          lookupResult.innerHTML = resultsHTML;
          lookupResult.classList.remove('hidden');

          lookupResult.scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
          });

        } else {

          // Check if this customer has cancelled bookings
          const cancelledBooking = db.find(b => {
            if (!b || b.status !== 'cancelled') return false;

            const matchId = b.bookingId === query;
            const matchMobile = b.mobile === query;

            const matchMobileNumbersOnly =
              b.mobile &&
              b.mobile.replace(/\D/g, '') === queryNumbersOnly;

            return matchId || matchMobile || matchMobileNumbersOnly;
          });

          if (cancelledBooking) {

            lookupResult.innerHTML = `
              <div style="
                background: #f3f4f6;
                padding: 16px;
                border-radius: 8px;
                border-left: 4px solid var(--gray-500);
              ">
                <strong>ℹ️ No Active Bookings</strong><br>
                You don't have any active bookings at the moment.<br>
                <small style="color: var(--gray-600);">
                  Previous bookings have been cancelled or completed.
                </small>
              </div>
            `;

          } else {

            lookupResult.innerHTML = `
              <div style="
                background: #fee2e2;
                padding: 16px;
                border-radius: 8px;
                border-left: 4px solid var(--danger);
                color: #991b1b;
              ">
                <strong>❌ No booking found</strong><br>
                Please check your Booking ID or Phone Number and try again.
              </div>
            `;
          }

          lookupResult.classList.remove('hidden');
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

    async function getFacilitySettingsFromFirestore() {
      const fallback = {
        facilityStatus: 'open',
        courts: {
          'Court 1': 'open',
          'Court 2': 'open'
        }
      };

      try {
        await waitForFirebase();
        if (!window.db || !window.firebaseFunctions) return fallback;

        // Use collection/getDocs so this works even on pages that do not expose getDoc.
        const { collection, getDocs } = window.firebaseFunctions;
        const snapshot = await getDocs(collection(window.db, 'settings'));
        const facilityDoc = snapshot.docs.find(document =>
          document.id === 'facility' || document.data()?.settingsKey === 'facility'
        );

        if (facilityDoc) {
          const data = facilityDoc.data();
          return {
            ...fallback,
            ...data,
            courts: {
              ...fallback.courts,
              ...(data.courts || {})
            }
          };
        }

      } catch (error) {
        console.error('Error loading facility settings:', error);
      }

      return fallback;
    }


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
    window.cancelBookingFunc = async function(bookingId) {
      if (
        confirm(
          'Are you sure you want to cancel this booking? This will cancel ALL hours for this booking.'
        )
      ) {
        try {
          await updateBookingStatus(bookingId, 'cancelled');

          alert('Booking cancelled.');

          const lookupResult = document.getElementById('lookupResult');
          if (lookupResult) {
            lookupResult.classList.add('hidden');
          }

          renderCalendar();

          if (typeof renderMobileSchedule === 'function') {
            renderMobileSchedule();
          }
        } catch (error) {
          console.error('Error cancelling booking:', error);
          alert('There was an error cancelling the booking. Please try again.');
        }
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
      
      if (applyBtn) {
        applyBtn.addEventListener('click', () => {
          currentPage = 1;
          loadAdminData();
        });
      }

      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          document.getElementById('adminDateFilter').value = '';
          document.getElementById('adminCourtFilter').value = '';
          document.getElementById('adminStatusFilter').value = '';
          currentPage = 1;
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
      const groupedBookings = {};

      bookings.forEach(b => {
        if (b.status === 'cancelled') return;

        const key = b.bookingId || b.id;

        if (!groupedBookings[key]) {
          groupedBookings[key] = b;
        }
      });

      return Object.values(groupedBookings).reduce((sum, booking) => {
        return sum + calculateBookingTotal(booking);
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
      
      // 3. Apply filters. Hide cancelled bookings by default, but allow
      // the Cancelled status filter to show them when explicitly requested.
      let filteredBookings = statusFilter
        ? [...db]
        : db.filter(b => b.status !== 'cancelled');
      
      if (dateFilter) filteredBookings = filteredBookings.filter(b => b.date === dateFilter);
      if (courtFilter) filteredBookings = filteredBookings.filter(b => b.court === courtFilter);
      if (statusFilter) filteredBookings = filteredBookings.filter(b => b.status === statusFilter);
      
      // 4. Update stats
      const totalBookings = new Set(
      db
        .filter(b => b.status !== 'cancelled')
        .map(b => b.bookingId || b.id)
    ).size;
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
      const pagination = document.getElementById('adminPagination');
      const paginationSummary = document.getElementById('paginationSummary');

      if (!tbody) return;

      // Group hourly Firestore records into one visible reservation per booking ID.
      const grouped = {};
      bookings.forEach(b => {
        const key = b.bookingId || b.id;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push(b);
      });

      const bookingGroups = Object.values(grouped);

      // Newest reservations first. Fall back to booked date/time for older records
      // that do not have a createdAt value.
      const getGroupSortValue = (group) => {
        const first = group[0] || {};
        const created = first.createdAt;

        if (created?.seconds) return created.seconds * 1000;
        if (typeof created === 'number') return created;
        if (typeof created === 'string') {
          const parsed = Date.parse(created);
          if (!Number.isNaN(parsed)) return parsed;
        }

        const fallback = Date.parse(`${first.date || '1970-01-01'}T${first.time || '00:00'}:00`);
        return Number.isNaN(fallback) ? 0 : fallback;
      };

      bookingGroups.sort((a, b) => getGroupSortValue(b) - getGroupSortValue(a));

      if (bookingGroups.length === 0) {
        currentPage = 1;
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

        if (paginationSummary) paginationSummary.textContent = 'No bookings to display';
        if (pagination) pagination.innerHTML = '';
        return;
      }

      const totalBookings = bookingGroups.length;
      const totalPages = Math.max(1, Math.ceil(totalBookings / itemsPerPage));
      currentPage = Math.min(Math.max(1, currentPage), totalPages);

      const startIndex = (currentPage - 1) * itemsPerPage;
      const endIndex = Math.min(startIndex + itemsPerPage, totalBookings);
      const pageGroups = bookingGroups.slice(startIndex, endIndex);

      if (paginationSummary) {
        paginationSummary.textContent =
          `Showing ${startIndex + 1}-${endIndex} of ${totalBookings} bookings`;
      }

      tbody.innerHTML = pageGroups.map(group => {
        group.sort((a, b) => a.time.localeCompare(b.time));

        const first = group[0];
        const last = group[group.length - 1];
        const duration = group.length;
        const total = calculateBookingTotal(first);

        const lastHour = parseInt(last.time.split(':')[0], 10);
        const endHour = lastHour + 1;
        const endTimeStr = `${endHour.toString().padStart(2, '0')}:00`;

        const addonsText = [];
        if (first.addons?.paddle > 0) addonsText.push(`${first.addons.paddle}x Paddle`);
        if (first.addons?.ball > 0) addonsText.push(`${first.addons.ball}x Ball`);

        return `
          <!-- DESKTOP TABLE ROW -->
          <tr class="desktop-booking-row">
            <td><strong>${first.bookingId || first.id}</strong></td>
            <td>${first.date}</td>
            <td>
              ${formatTime12(first.time)} - ${formatTime12(endTimeStr)}
              <br>
              <small style="color:var(--gray-500)">(${duration}h)</small>
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
              <button
                class="action-btn view"
                style="background:#e0e7ff; color:#3730a3;"
                onclick="openEditModal('${first.bookingId}')">
                Edit
              </button>
              <button
                class="action-btn view"
                onclick="viewBookingDetails('${first.bookingId}')">
                View
              </button>
            </td>
          </tr>

          <!-- MOBILE BOOKING CARD -->
          <tr
            class="mobile-booking-card"
            onclick="viewBookingDetails('${first.bookingId}')"
          >
            <td colspan="10">
              <div class="mobile-booking-inner">
                <div class="mobile-booking-main">
                  <div class="mobile-booking-top">
                    <div class="mobile-booking-id">${first.bookingId || first.id}</div>
                    <span class="mobile-status-badge ${first.status || 'confirmed'}">
                      ${(first.status || 'confirmed').toUpperCase()}
                    </span>
                  </div>
                  <div class="mobile-booking-name">${first.name}</div>
                  <div class="mobile-booking-time">
                    🕐 ${formatTime12(first.time)} - ${formatTime12(endTimeStr)}
                  </div>
                </div>
                <div class="mobile-booking-arrow">›</div>
              </div>
            </td>
          </tr>
        `;
      }).join('');

      renderAdminPagination(totalPages);
    }

    function getAdminPaginationItems(totalPages) {
      if (totalPages <= 7) {
        return Array.from({ length: totalPages }, (_, index) => index + 1);
      }

      const pages = new Set([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
      const validPages = [...pages]
        .filter(page => page >= 1 && page <= totalPages)
        .sort((a, b) => a - b);

      const items = [];
      validPages.forEach((page, index) => {
        if (index > 0 && page - validPages[index - 1] > 1) items.push('ellipsis');
        items.push(page);
      });

      return items;
    }

    function renderAdminPagination(totalPages) {
      const pagination = document.getElementById('adminPagination');
      if (!pagination) return;

      if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
      }

      const pageItems = getAdminPaginationItems(totalPages);

      pagination.innerHTML = `
        <button
          type="button"
          class="pagination-btn pagination-nav"
          ${currentPage === 1 ? 'disabled' : ''}
          onclick="goToAdminPage(${currentPage - 1})"
          aria-label="Previous page">
          ← <span>Previous</span>
        </button>

        <div class="pagination-pages">
          ${pageItems.map(item => {
            if (item === 'ellipsis') {
              return '<span class="pagination-ellipsis" aria-hidden="true">…</span>';
            }

            return `
              <button
                type="button"
                class="pagination-btn pagination-number ${item === currentPage ? 'active' : ''}"
                onclick="goToAdminPage(${item})"
                ${item === currentPage ? 'aria-current="page"' : ''}>
                ${item}
              </button>
            `;
          }).join('')}
        </div>

        <button
          type="button"
          class="pagination-btn pagination-nav"
          ${currentPage === totalPages ? 'disabled' : ''}
          onclick="goToAdminPage(${currentPage + 1})"
          aria-label="Next page">
          <span>Next</span> →
        </button>
      `;
    }

    window.goToAdminPage = function(page) {
      const targetPage = parseInt(page, 10);
      if (!Number.isFinite(targetPage) || targetPage < 1 || targetPage === currentPage) return;

      currentPage = targetPage;
      loadAdminData();

      const tableCard = document.querySelector('.table-card');
      if (tableCard) {
        tableCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };

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

      // Get ALL hourly records for this booking
      const bookings = db.filter(b => b.bookingId === id);

      if (bookings.length > 0) {
        // Always use the earliest booked hour
        bookings.sort((a, b) => a.time.localeCompare(b.time));

        const firstBooking = bookings[0];

        const confirmationData = {
          ...firstBooking,

          // Use saved duration, or number of hourly records as fallback
          duration: firstBooking.duration || bookings.length
        };

        await notifyCustomerOfConfirmation(confirmationData);
      }

      showToast(
        `Booking ${id} confirmed! Customer notified.`,
        'success'
      );

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
      const key = b.bookingId || b.id;

      if (!uniqueBookings[key]) {
        uniqueBookings[key] = b;
      }
    });

    const finalBookings = Object.values(uniqueBookings);

      let totalEarnings = 0;
      
      const headers = ['ID', 'Date', 'Time', 'Court', 'Name', 'Email', 'Mobile', 'Payment', 'Paddles', 'Balls', 'Total', 'Status'];
      
      const rows = finalBookings.map(b => {
    let safeTotal = b.totalAmount;

    if (!safeTotal) {
      safeTotal = calculateBookingTotal(b);
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
      const key = b.bookingId || b.id;

      if (!uniqueBookings[key]) {
        uniqueBookings[key] = b;
      }
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
          safeTotal = calculateBookingTotal(booking);
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
      const times = TIME_SLOTS;
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
        if (newStatus !== 'cancelled') {
          const openPlayCheck = await validateOpenPlayRestriction(
            newDate,
            newTime,
            newDuration,
            newCourt
          );

          if (!openPlayCheck.allowed) {
            alert(openPlayCheck.message);
            return;
          }
        }

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
      doc,
      writeBatch
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
    // ATOMICALLY REPLACE OLD BOOKING RECORDS
    // ==========================================

    const batch = writeBatch(window.db);

    // Delete all old hourly records
    snapshot.docs.forEach(document => {
      batch.delete(
        doc(window.db, 'bookings', document.id)
      );
    });

    // Create all new hourly records
    for (let i = 0; i < newDuration; i++) {
      const currentHour = startHour + i;

      const currentTimeStr =
        `${currentHour.toString().padStart(2, '0')}:00`;

      const payload = {
        bookingId: id,
        date: newDate,
        time: currentTimeStr,
        court: newCourt,

        name: originalBooking.name,
        mobile: originalBooking.mobile,
        email: originalBooking.email,
        payment: originalBooking.payment,

        addons: {
          paddle: newPaddle,
          ball: newBall
        },

        duration: newDuration,

        totalAmount: calculateBookingTotal({
          time: newTime,
          duration: newDuration,
          addons: {
            paddle: newPaddle,
            ball: newBall
          }
        }),

        status: newStatus
      };

      const newBookingRef =
        doc(collection(window.db, 'bookings'));

      batch.set(newBookingRef, payload);
    }

    // Commit deletes + new records together
    await batch.commit();

    console.log('Booking records replaced successfully.');

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

      const addonsPrice = (paddleQty * 30) + (ballQty * 100);
      const total = calculateBookingTotal({
        time: editTime,
        duration,
        addons: { paddle: paddleQty, ball: ballQty }
      });
      const courtPrice = total - addonsPrice;

      document.getElementById('editTotalAmount').textContent = `₱${total}`;
      document.getElementById('editDurationDisplay').textContent = duration;

      // Display the calculated court price
      document.getElementById('editCourtRateDisplay').textContent = `₱${courtPrice}`;
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
      const bookingId = bookingData.bookingId || bookingData.id;

      // Get all hourly records belonging to this booking
      const db = await getBookings();

      const bookings = db
        .filter(b => b.bookingId === bookingId)
        .sort((a, b) => a.time.localeCompare(b.time));

      // Fallback in case records cannot be found
      const firstBooking =
        bookings.length > 0 ? bookings[0] : bookingData;

      const lastBooking =
        bookings.length > 0
          ? bookings[bookings.length - 1]
          : bookingData;

      const duration =
        bookings.length > 0
          ? bookings.length
          : (parseInt(bookingData.duration) || 1);

      // Actual first booked hour
      const startTime = firstBooking.time;

      // Actual ending hour = last booked slot + 1 hour
      const lastHour = parseInt(lastBooking.time.split(':')[0]);
      const endHour = lastHour + 1;

      const endTimeStr =
        `${endHour.toString().padStart(2, '0')}:00`;

      const timeRange =
        `${formatTime12(startTime)} - ${formatTime12(endTimeStr)}`;

      const total =
        firstBooking.totalAmount ||
        bookingData.totalAmount ||
        calculateBookingTotal({
          ...firstBooking,
          duration
        });

      console.log('📧 CONFIRMATION EMAIL DATA:', {
        bookingId,
        storedTimes: bookings.map(b => b.time),
        startTime,
        endTimeStr,
        duration,
        timeRange
      });

      const customerParams = {
        booking_id: bookingId,
        customer_name: firstBooking.name,
        booking_date: firstBooking.date,
        booking_time: timeRange,
        court: firstBooking.court,
        duration: duration,
        total_amount: total,
        to_email: firstBooking.email,
        to_name: firstBooking.name
      };

      try {
        if (
          customerParams.to_email &&
          customerParams.to_email.includes('@')
        ) {
          await emailjs.send(
            'service_i5zradf',
            'template_hra91so',
            customerParams
          );

          console.log(
            '✅ Customer confirmation email sent successfully!'
          );
        } else {
          console.warn(
            '⚠️ Customer email skipped: Invalid email address.'
          );
        }
      } catch (error) {
        console.error(
          '❌ Failed to send customer email:',
          error
        );
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
     return hour < 18;
    }


    // Universal calculator for Admin Dashboard, Emails, Booking Page, and Exports
    // Every hourly block before 6 PM costs ₱200; every block from 6 PM onward costs ₱300.
    function calculateBookingTotal(data) {
      const duration = Math.max(1, parseInt(data?.duration) || 1);
      const startHour = parseInt((data?.time || "00:00").split(':')[0]);

      let courtPrice = 0;

      for (let i = 0; i < duration; i++) {
        const currentHour = startHour + i;
        courtPrice += currentHour < 18 ? RATE_AM : RATE_PM;
      }

      const paddleQty = Math.max(0, parseInt(data?.addons?.paddle) || 0);
      const ballQty = Math.max(0, parseInt(data?.addons?.ball) || 0);
      const addonsPrice = (paddleQty * 30) + (ballQty * 100);

      return courtPrice + addonsPrice;
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

    // Update the booking total calculation
    function updateBookingTotal() {
      const duration = parseInt(document.getElementById('bookingDuration')?.value || 1);
      const paddleQty = parseInt(document.getElementById('paddleQty')?.textContent || 0);
      const ballQty = parseInt(document.getElementById('ballQty')?.textContent || 0);
      const selectedTime = document.getElementById('hiddenTime')?.value || '';

      const addonsPrice = (paddleQty * 30) + (ballQty * 100);
      const total = selectedTime
        ? calculateBookingTotal({
            time: selectedTime,
            duration,
            addons: { paddle: paddleQty, ball: ballQty }
          })
        : addonsPrice;

      const addonsDisplay = document.getElementById('addonsPriceDisplay');
      const totalDisplay = document.getElementById('grandTotalDisplay');

      if (addonsDisplay) addonsDisplay.textContent = `₱${addonsPrice}`;
      if (totalDisplay) totalDisplay.textContent = `₱${total}`;

      const revTotal = document.getElementById('rev-total');
      if (revTotal) revTotal.textContent = `₱${total}`;

      return total;
    }

    // Initialize on page load
    document.addEventListener('DOMContentLoaded', () => {
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
