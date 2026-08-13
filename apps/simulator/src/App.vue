<template>
  <main class="simulator-shell">
    <section class="workspace" aria-labelledby="simulator-title">
      <header>
        <p class="eyebrow">Veetee Protocol Lab</p>
        <div class="heading-row">
          <div>
            <h1 id="simulator-title">Trình mô phỏng thiết bị</h1>
            <p class="intro">Không gian sạch để kiểm thử kết nối và thông điệp giao thức.</p>
          </div>
          <span class="status" data-testid="connection-status">
            <span class="status-dot" aria-hidden="true"></span>
            Chưa kết nối
          </span>
        </div>
      </header>

      <div class="console-grid">
        <article class="panel connection-panel">
          <span class="panel-index">01</span>
          <h2>Kết nối thử nghiệm</h2>
          <p>Địa chỉ và thông tin xác thực sẽ được nhập rõ ràng trong luồng mô phỏng tiếp theo.</p>
          <button type="button">Kết nối</button>
        </article>

        <article class="panel event-panel">
          <div class="panel-heading">
            <div>
              <span class="panel-index">02</span>
              <h2>Nhật ký phiên</h2>
            </div>
            <span class="event-count">0 sự kiện</span>
          </div>
          <div class="empty-state">
            <span aria-hidden="true">{ }</span>
            <p>Thông điệp giao thức sẽ xuất hiện tại đây.</p>
          </div>
        </article>
      </div>
    </section>
  </main>
</template>
