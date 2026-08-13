<script setup lang="ts">
const areas = [
  {
    label: 'Thiết bị',
    description: 'Ghép nối và theo dõi các thiết bị đã đăng ký.',
    accent: 'bg-emerald-400',
  },
  {
    label: 'Nhà cung cấp',
    description: 'Chuẩn bị cấu hình giọng nói theo từng vai trò.',
    accent: 'bg-sky-400',
  },
  {
    label: 'Vận hành',
    description: 'Quan sát trạng thái dịch vụ và các phiên gần đây.',
    accent: 'bg-amber-300',
  },
];
</script>

<template>
  <main class="min-h-screen overflow-hidden bg-slate-950 text-slate-100">
    <div class="pointer-events-none fixed inset-0 opacity-70" aria-hidden="true">
      <div class="absolute -left-24 top-16 h-72 w-72 rounded-full bg-emerald-500/20 blur-3xl"></div>
      <div class="absolute right-0 top-0 h-96 w-96 rounded-full bg-sky-500/15 blur-3xl"></div>
    </div>

    <div class="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-14">
      <header class="flex items-center justify-between border-b border-white/10 pb-6">
        <a class="flex items-center gap-3 font-semibold tracking-wide" href="/" aria-label="Veetee">
          <span class="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-300 text-sm font-black text-slate-950">VT</span>
          <span>Veetee</span>
        </a>
        <span class="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-xs font-medium text-emerald-200">
          Nền tảng đang khởi tạo
        </span>
      </header>

      <section class="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p class="mb-4 text-sm font-semibold uppercase tracking-[0.28em] text-emerald-300">Không gian quản trị</p>
          <h1 class="max-w-3xl text-4xl font-semibold leading-tight tracking-tight sm:text-6xl">Điều khiển Veetee</h1>
          <p class="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
            Một điểm làm việc rõ ràng để cấu hình thiết bị, dịch vụ giọng nói và hoạt động realtime.
          </p>
        </div>

        <div class="grid gap-4" aria-label="Các khu vực quản trị">
          <article
            v-for="(area, index) in areas"
            :key="area.label"
            class="group rounded-3xl border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-slate-950/20 backdrop-blur"
          >
            <div class="flex items-start gap-4">
              <span :class="area.accent" class="mt-2 h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_20px_currentColor]"></span>
              <div class="min-w-0">
                <div class="flex items-center justify-between gap-4">
                  <h2 class="text-lg font-semibold">{{ area.label }}</h2>
                  <span class="font-mono text-xs text-slate-500">0{{ index + 1 }}</span>
                </div>
                <p class="mt-2 text-sm leading-6 text-slate-400">{{ area.description }}</p>
              </div>
            </div>
          </article>
        </div>
      </section>

      <footer class="border-t border-white/10 pt-5 text-xs text-slate-500">
        Giao diện nền tảng tối thiểu — các luồng quản trị sẽ được bổ sung theo từng mốc.
      </footer>
    </div>
  </main>
</template>
