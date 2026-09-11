// frontend/js/report-form.js
//
// Shared logic for the "Report Missing Person" and "Report Found Person"
// forms. Both pages include this file and call setupReportForm() with
// their form's id and a message-box element to show results in.
//
// Kept as plain functions (no framework) so it's easy to read top to bottom.

// Wires up the "Auto-fill with AI" button on a report form. Calls
// POST /api/ai/parse-intake with the free text the person typed, then
// fills in whatever fields the AI could confidently extract — never
// submits anything on its own, and always leaves the form editable so a
// human reviews the result before hitting Submit.
function setupSmartIntake({ textareaId, buttonId, statusId, formId, reportType }) {
  const button = document.getElementById(buttonId);
  const textarea = document.getElementById(textareaId);
  const status = document.getElementById(statusId);
  const form = document.getElementById(formId);

  button.addEventListener('click', async () => {
    const text = textarea.value.trim();
    if (!text) {
      status.innerHTML = `<div class="status-message error">Type a description first.</div>`;
      return;
    }

    button.disabled = true;
    button.textContent = 'Reading...';
    // Gemini's free tier occasionally takes a few seconds (it retries
    // transient errors server-side) — say so, rather than looking stuck.
    status.innerHTML = `<div style="color:#6b675e; font-size:0.85rem;">This can take up to 15 seconds...</div>`;

    try {
      const response = await fetch('/api/ai/parse-intake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, report_type: reportType }),
      });
      const data = await response.json();

      if (!data.ok || !data.fields) {
        status.innerHTML = `<div class="status-message error">Couldn't auto-fill this time — no problem, just fill in the fields below manually.</div>`;
        return;
      }

      let filledCount = 0;
      for (const [key, value] of Object.entries(data.fields)) {
        if (value === null || value === undefined || value === '') continue;
        const input = form.elements[key];
        if (!input) continue;

        let cleanValue = value;
        // <input type="datetime-local"> only accepts "YYYY-MM-DDTHH:mm"
        // (no seconds, no timezone) — strip anything past that or the
        // browser silently rejects the whole value.
        if (input.type === 'datetime-local' && typeof value === 'string') {
          cleanValue = value.slice(0, 16);
        }

        input.value = cleanValue;
        if (input.value) filledCount++; // browsers leave .value empty if it rejected the format
      }

      status.innerHTML = filledCount > 0
        ? `<div class="status-message success">Filled in ${filledCount} field(s) below — please check them over before submitting.</div>`
        : `<div class="status-message error">Couldn't find enough detail in that description — please fill in the fields manually.</div>`;
    } catch (err) {
      status.innerHTML = `<div class="status-message error">Something went wrong — please fill in the fields below manually.</div>`;
    } finally {
      button.disabled = false;
      button.textContent = 'Auto-fill with AI';
    }
  });
}

function setupReportForm(formId, messageBoxId) {
  const form = document.getElementById(formId);
  const messageBox = document.getElementById(messageBoxId);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';
    messageBox.innerHTML = '';

    try {
      // FormData automatically picks up every input's name="" + value,
      // including the file input, and sends it as multipart/form-data —
      // exactly what the backend's /api/reports route expects.
      const formData = new FormData(form);

      const response = await fetch('/api/reports', {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      if (!response.ok) {
        // The backend sends { error: "..." } on 400s — show that message
        // directly rather than a generic failure.
        throw new Error(data.error || 'Something went wrong. Please try again.');
      }

      // Success: show the case ID prominently and clear the form so it's
      // obvious the submission went through.
      messageBox.innerHTML = `
        <div class="status-message success">
          <p>Report submitted successfully.</p>
          <p>Your case ID is <span class="case-id-display">${data.case_id}</span></p>
          <p>Save this ID — you'll need it to check status later on the
             <a href="status.html">Case Status</a> page.</p>
        </div>
      `;
      form.reset();
    } catch (err) {
      messageBox.innerHTML = `
        <div class="status-message error">
          <p>Could not submit report: ${err.message}</p>
        </div>
      `;
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = 'Submit Report';
    }
  });
}
