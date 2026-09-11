// frontend/js/report-form.js
//
// Shared logic for the "Report Missing Person" and "Report Found Person"
// forms. Both pages include this file and call setupReportForm() with
// their form's id and a message-box element to show results in.
//
// Kept as plain functions (no framework) so it's easy to read top to bottom.

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
