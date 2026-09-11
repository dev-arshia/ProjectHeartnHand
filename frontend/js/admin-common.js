// frontend/js/admin-common.js
//
// Shared across every admin page: checks the visitor is actually logged
// in (redirects to login.html if not) and renders the topbar with a
// logout button. Every admin page except login.html should call
// requireAdminSession() near the top of its own <script>.

async function requireAdminSession() {
  try {
    const res = await fetch('/api/admin/me');
    if (!res.ok) throw new Error('not logged in');
    const data = await res.json();
    renderAdminTopbar(data.username);
    return data;
  } catch (err) {
    window.location.href = 'login.html';
    return null;
  }
}

function renderAdminTopbar(username) {
  const bar = document.getElementById('admin-topbar');
  if (!bar) return;
  bar.innerHTML = `
    <a href="dashboard.html">ProjectHeartnHand Admin</a>
    <div>
      <span class="whoami">${username}</span>
      &nbsp;
      <button class="btn-logout" id="logout-btn">Log out</button>
    </div>
  `;
  document.getElementById('logout-btn').addEventListener('click', async () => {
    await fetch('/api/admin/logout', { method: 'POST' });
    window.location.href = 'login.html';
  });
}

// Small helper used by dashboard/case/match-review pages to turn a
// status string into the right badge class + readable label.
function statusBadge(status) {
  const labels = {
    unverified: 'Unverified',
    possible_match: 'Possible Match',
    verified_match: 'Verified Match',
    rejected: 'Rejected',
    closed: 'Closed',
  };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}
