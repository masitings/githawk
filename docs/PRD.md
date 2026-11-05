
# PRD GitHawk — Git Client Desktop (Rust + Tauri)
 · 
## 1. Ringkasan
GitHawk adalah Git client desktop lintas platform (Windows, macOS, Linux) yang menyamai kemampuan inti GitKraken Desktop 12.x, dibangun dengan Rust + Tauri agar jauh lebih ringan dan cepat. Target rilis publik pertama (v1.0) mencakup seluruh fitur Git lokal dan integrasi hosting; GitHawk sepenuhnya lokal dan tidak memiliki fitur cloud. GitHawk dikembangkan sebagai proyek open-source sejak hari pertama.
Latar belakang. GitKraken adalah Git GUI paling populer di kelasnya, tetapi berbasis Electron. Installer-nya sekitar 390 MB dan pengguna sering mengeluhkan konsumsi memori. Sejak v12.3, beberapa fitur (login, review PR) dipindah ke web gitkraken.dev, sehingga aplikasi makin bergantung pada cloud dan akun.
Problem statement. Developer butuh Git client visual yang:
ringan dan cepat dibuka, termasuk di repo besar;
bekerja penuh secara lokal tanpa wajib login;
tetap memberi kontrol penuh untuk power user (rebase, reflog, worktree);
harganya terjangkau untuk developer individu dan tim kecil.
Catatan merek. GitHawk meniru kapabilitas, bukan identitas. Nama, logo, warna, ikon, dan tata letak khas GitKraken tidak disalin. Nama "GitHawk" perlu dicek ketersediaannya (pernah dipakai client GitHub iOS open-source yang kini tidak aktif).
## 2. Tujuan dan non-tujuan
GitHawk v1.0 harus bisa menggantikan GitKraken untuk alur kerja Git harian developer individu dan tim kecil, dengan jejak resource yang jauh lebih kecil.
Tujuan
Paritas fitur Git lokal dengan GitKraken Desktop: graph, staging, branch, merge, rebase, interactive rebase, stash, tag, worktree, submodule, LFS, hooks, signing.
Integrasi GitHub, GitLab, Bitbucket, dan Azure DevOps untuk clone, remote, dan pull request.
Performa sebagai pembeda utama: installer kecil, startup cepat, memori rendah, graph mulus di repo besar.
100% lokal: tanpa akun GitHawk, server, sinkronisasi, atau telemetri.
Fitur power user yang tidak ditonjolkan GitKraken, misalnya reflog viewer dan kontrol rebase yang lebih detail.
Non-tujuan (v1.0)
Semua fitur cloud, termasuk Workspaces, Cloud Patches, Insights, dan conflict prevention lintas tim. Fitur ini tidak akan dibangun, bukan sekadar ditunda.
SSO, admin console, dan manajemen organisasi.
Code editor penuh setara IDE (cukup editor ringan untuk konflik dan edit cepat).
Integrasi issue tracker (Jira, Trello) dan aplikasi mobile.
Versi on-premise.
### Model open-source
GitHawk sepenuhnya open-source: seluruh kode aplikasi dipublikasikan di GitHub dan semua fitur gratis tanpa batas, tanpa versi berbayar terpisah.
Aspek
Keputusan atau usulan
Lisensi
Usulan Apache-2.0 (permisif, ada perlindungan paten, ramah kontributor perusahaan); alternatif GPL-3.0 jika turunan wajib tetap open-source. Belum final
Repositori
Monorepo di GitHub: src-tauri/ (core Rust), src/ (UI React), crates/ (pustaka Git yang bisa dipakai ulang), docs/
Kontribusi
CONTRIBUTING.md, CODE_OF_CONDUCT.md, template issue dan PR, label good first issue, DCO sign-off
CI/CD
GitHub Actions: lint, test, benchmark performa, build installer 3 OS, rilis bertanda tangan
Code signing
Sertifikat Apple Developer dan Windows code signing, atau program code signing gratis untuk proyek OSS
Keamanan
SECURITY.md dengan kanal laporan privat; cargo audit dan npm audit di CI
Pendanaan
GitHub Sponsors atau Open Collective; donasi tidak membuka fitur tambahan
Telemetri
Tidak ada telemetri; aplikasi tidak mengirim data ke server GitHawk
Merek
Kode bebas di-fork, tetapi nama dan logo GitHawk diatur kebijakan merek terpisah
## 3. Persona dan use case
Tiga persona menjadi acuan prioritas; persona pertama adalah target utama v1.0.
Persona
Profil
Kebutuhan utama
Frustrasi dengan tool saat ini
Rina, developer individu
Fullstack, freelance atau startup, 2–10 repo aktif, laptop 8–16 GB RAM
Graph yang jelas, staging cepat, PR tanpa buka browser
GitKraken berat dan butuh langganan untuk repo privat
Bima, power user
Senior engineer, sering rebase, cherry-pick, worktree
Interactive rebase, reflog, undo yang bisa dipercaya, shortcut keyboard
GUI terasa membatasi untuk operasi Git tingkat lanjut
Tim kecil (3–10 orang)
Startup atau agensi, satu provider hosting
Integrasi PR, profil kerja/pribadi, harga per kursi rendah
Biaya per kursi naik, fitur penting pindah ke paket lebih mahal
Use case utama
Membuka repo, melihat graph, dan memahami riwayat branch dalam hitungan detik.
Men-stage perubahan per file, per hunk, atau per baris, lalu commit dengan pesan yang dibantu AI.
Merge atau rebase branch lewat drag-and-drop, lalu menyelesaikan konflik di editor 3 panel.
Merapikan riwayat dengan interactive rebase sebelum push.
Membuat dan me-review pull request tanpa meninggalkan aplikasi.
Membatalkan operasi yang salah dengan satu klik undo.
Menjalankan beberapa coding agent paralel di worktree terpisah dan memantau statusnya.
## 4. Analisis kompetitor: fitur GitKraken Desktop 12.x
GitKraken Desktop 12.x punya sekitar 13 kelompok fitur; sebagian besar fitur Git lanjutan dibatasi ke repo publik pada paket gratis, dan fitur tim membutuhkan cloud GitKraken. Versi terbaru yang dicek adalah 12.3.1 (Juli 2026); v12.0 (April 2026) menambahkan Agent Sessions View.
Modul
Fitur GitKraken
Catatan
Repo & navigasi
Open, clone, init; tab multi-repo dengan alias; repo favorit; fork; command palette dan fuzzy finder; keyboard shortcut; deep link ke branch atau commit; search commit
Gratis
Commit graph
Graph live tersinkron, kolom bisa diatur, hide dan solo branch, ghost branch, detached HEAD
Inti produk
Staging & commit
Stage per file, hunk, dan baris; ignore file; amend; color-coded status file
Gratis
Branch & remote
Create, checkout, rename, delete; drag-and-drop merge, rebase, push; pull (merge, ff-only, rebase); multi-remote
Gratis
Riwayat lanjutan
Interactive rebase visual, interactive cherry-pick multi-commit, squash, undo/redo satu klik
Hanya repo publik di paket gratis
Konflik
Merge tool bawaan, editor hasil merge, deteksi konflik dasar
Editor konflik penuh di paket berbayar
File
Diff viewer, file history, blame, editor file bawaan
History dan blame repo privat berbayar
Git lanjutan
Stash, tag, worktree, submodule, Git LFS, Gitflow, Git hooks, GPG atau SSH signing, auto-gen SSH key
Worktree dan LFS repo privat berbayar
Terminal
Terminal bawaan dengan auto-suggest dan auto-complete perintah Git
Gratis
Integrasi hosting
GitHub, GitLab, Bitbucket, Azure DevOps (termasuk Enterprise/self-managed); PR list, buat PR, filter PR; GitHub Actions
Self-hosted di paket Advanced ke atas
Issue & tim
Jira, GitHub Issues, GitLab Issues; Launchpad; Workspaces; Cloud Patches; conflict prevention tim; Insights
Butuh akun dan cloud GitKraken
AI & agen
Pesan commit, explain commit, changelog, stash AI; Agent Sessions View (worktree + coding agent paralel, status Claude Code)
Kredit AI per paket
Akun & admin
Multi-profil, login via browser (sejak 12.3), SSO, admin console, on-premise
Profil berbayar; SSO Advanced ke atas
Sumber: GitKraken Help Center, Release Notes 12.x, Halaman fitur GitKraken, Rilis v12.0 Agent Mode.
## 5. Gap analysis
GitHawk mengejar paritas di semua fitur Git lokal, mengungguli GitKraken di performa, akses gratis, dan alat power user, serta sengaja tidak membangun fitur cloud apa pun. Strategi dibagi empat: Ungguli (lebih baik dari GitKraken), Paritas (setara), Tunda (setelah v1.0), dan Tidak dikejar.
Area
Kondisi GitKraken
Rencana GitHawk
Gap / peluang
Strategi
Ukuran & performa
Electron, installer sekitar 390 MB, dikeluhkan berat
Tauri + Rust, target installer < 25 MB, RAM idle < 150 MB
Pembeda utama
Ungguli
Akses fitur
Rebase, history, LFS, worktree hanya repo publik di paket gratis
Semua fitur gratis dan open-source untuk repo apa pun
Hambatan harga GitKraken
Ungguli
Ketergantungan akun
Login lewat browser, review PR dipindah ke gitkraken.dev
100% lokal tanpa akun GitHawk; login hanya ke provider hosting pilihan pengguna
Privasi dan kerja offline
Ungguli
Power user
Reflog tidak ditonjolkan, GUI dinilai membatasi
Reflog viewer, edit todo rebase mentah, log perintah Git yang dijalankan
Celah yang jarang diisi kompetitor
Ungguli
Commit graph
Graph live, hide/solo, ghost branch
Graph WebGL/Canvas dengan virtual scroll, layout dihitung di Rust
Risiko teknis tertinggi
Paritas
Staging, branch, remote
Lengkap, drag-and-drop
Lengkap, drag-and-drop
Tidak ada gap fungsional
Paritas
Interactive rebase & cherry-pick
Visual, multi-commit
Visual + mode teks mentah
Perlu kontrol GIT_SEQUENCE_EDITOR
Paritas
Undo/redo
Satu klik
Satu klik berbasis operation log + reflog
Harus sangat andal
Paritas
Konflik
Merge tool + editor hasil
Editor 3 panel (Monaco/CodeMirror)
Kualitas editor menentukan persepsi
Paritas
Git lanjutan
Stash, tag, worktree, submodule, LFS, Gitflow, hooks, signing
Sama, via git CLI
Butuh git terpasang atau dibundel
Paritas
Terminal
Terminal bawaan + autocomplete Git
Terminal PTY + autocomplete
Kompleksitas lintas OS
Paritas
Integrasi hosting & PR
4 provider + Enterprise, PR dan Actions
4 provider cloud dulu, Enterprise/self-managed di v1.x
Self-hosted ditunda
Paritas (bertahap)
AI
Commit message, explain, changelog, stash; kredit AI per paket
Bring-your-own API key (Claude, OpenAI, model lokal)
Tanpa biaya kredit tersembunyi
Ungguli
Agen paralel
Agent Sessions View
Panel agen berbasis worktree + PTY
Fitur baru, pasar belum jenuh
Paritas (v1.x)
Issue tracker
Jira, GitHub/GitLab Issues, Launchpad
Belum ada
GitHawk tertinggal
Tunda
Fitur tim cloud
Workspaces, Cloud Patches, conflict prevention, Insights
Tidak akan dibangun
Disengaja: GitHawk 100% lokal
Tidak dikejar
Enterprise
SSO, admin console, on-premise
Belum ada
Bukan target v1.0
Tidak dikejar
Kesimpulan. Posisi GitHawk: "semua kekuatan Git lokal GitKraken, tanpa beratnya, tanpa paywall, dan open-source". GitHawk sengaja tidak menyediakan fitur kolaborasi cloud; semua data tetap di mesin pengguna.
## 6. Kebutuhan fungsional
Ada 32 kebutuhan fungsional: 13 masuk MVP (P0), 12 melengkapi v1.0 (P1), 6 menyusul di v1.x (P2), dan 1 ditunda (P3). P0 = tanpa ini aplikasi tidak bisa dipakai harian; P1 = wajib untuk paritas dengan GitKraken; P2 = pembeda atau perluasan; P3 = di luar scope saat ini.
ID
Modul
Kebutuhan
Prioritas
FR-01
Repo
Open, clone, dan init repo lokal; tab multi-repo dengan alias; daftar repo terakhir
P0 MVP
FR-02
Graph
Commit graph bergaya GitKraken (lihat spesifikasi visual di bagian 8) dengan virtual scroll, tetap mulus di repo 100.000+ commit
P0 MVP
FR-03
Graph
Panel detail commit: pesan, author, tanggal, parent, daftar file berubah, diff
P0 MVP
FR-04
Staging
Stage, unstage, dan discard per file, per hunk, dan per baris
P0 MVP
FR-05
Commit
Commit dengan summary dan deskripsi, amend, peringatan panjang summary
P0 MVP
FR-06
Diff
Diff unified dan side-by-side dengan syntax highlighting; diff gambar dasar
P0 MVP
FR-07
Branch
Create, checkout, rename, delete, set upstream; tampilan ahead/behind
P0 MVP
FR-08
Remote
Fetch, pull (merge, ff-only, rebase), push, force push dengan lease; multi-remote
P0 MVP
FR-09
Merge/rebase
Merge dan rebase lewat menu konteks serta drag-and-drop branch di graph
P0 MVP
FR-10
Stash
Save (termasuk untracked), apply, pop, drop, lihat isi stash
P0 MVP
FR-11
Tag
Buat tag lightweight dan annotated, hapus, push tag
P0 MVP
FR-12
Autentikasi
SSH key, HTTPS token, credential helper sistem; token disimpan di keychain OS
P0 MVP
FR-13
Sinkronisasi
File watcher yang me-refresh status otomatis dan memberi tahu jika watcher berhenti
P0 MVP
FR-14
Riwayat
Interactive rebase visual (reorder, squash, fixup, edit, drop, reword) + mode teks mentah
P1 v1.0
FR-15
Riwayat
Cherry-pick tunggal dan multi-commit, revert, reset soft/mixed/hard
P1 v1.0
FR-16
Riwayat
Undo dan redo operasi Git satu klik dengan riwayat operasi yang terlihat
P1 v1.0
FR-17
Konflik
Editor konflik 3 panel (ours, theirs, hasil) dengan pilih per hunk dan edit manual
P1 v1.0
FR-18
File
File history dan blame per baris, termasuk mengikuti rename
P1 v1.0
FR-19
Power user
Reflog viewer dengan aksi pulihkan branch atau commit yang hilang
P1 v1.0
FR-20
Navigasi
Command palette, fuzzy finder file/branch/commit, keyboard shortcut yang bisa diubah
P1 v1.0
FR-21
Graph
Hide dan solo branch, filter, dan pencarian commit (pesan, author, SHA)
P1 v1.0
FR-22
Integrasi
Login OAuth GitHub, GitLab, Bitbucket, Azure DevOps; clone dari daftar repo; lihat dan buat PR
P1 v1.0
FR-23
Git lanjutan
Worktree, submodule, Git LFS, Git hooks, GPG/SSH commit signing
P1 v1.0
FR-24
Preferensi
Multi-profil (identitas Git, integrasi, pengaturan), tema terang dan gelap
P1 v1.0
FR-25
Terminal
Terminal bawaan per repo dengan autocomplete perintah dan nama branch
P1 v1.0
FR-26
Alur kerja
Dukungan Gitflow (feature, release, hotfix)
P2 v1.x
FR-27
AI
Generate pesan commit, explain commit, changelog; bring-your-own API key atau model lokal
P2 v1.x
FR-28
Agen
Panel agen paralel: buat worktree, jalankan setup command, luncurkan coding agent, pantau status
P2 v1.x
FR-29
Integrasi
Review PR di aplikasi: komentar per baris, approve, request changes
P2 v1.x
FR-30
Integrasi
GitHub Enterprise, GitLab self-managed, Bitbucket Data Center
P2 v1.x
FR-31
Navigasi
Deep link githawk:// ke repo, branch, atau commit
P2 v1.x
FR-32
Issue
Integrasi Jira dan GitHub/GitLab Issues
P3 Nanti
## 7. Kebutuhan non-fungsional
Performa adalah janji utama produk, jadi setiap target di bawah diuji otomatis di CI pada repo acuan (misalnya repo Linux kernel untuk skala besar).
Aspek
Target
Cara ukur
Ukuran installer
< 25 MB (tanpa git yang dibundel)
Artefak build per OS
Cold start
< 1,5 detik sampai jendela siap
Benchmark di laptop acuan
Buka repo 100.000 commit
Graph tampil < 2 detik
Benchmark otomatis
Scroll graph
60 fps di repo besar
Profiling frontend
Memori idle (1 repo terbuka)
< 150 MB
Monitor proses
Refresh status setelah perubahan file
< 300 ms di repo menengah
Test file watcher
Platform
Windows 10+, macOS 12+ (Intel dan Apple Silicon), Linux (deb, rpm, AppImage, Flatpak)
Matriks CI
Keamanan kredensial
Token hanya di keychain OS, tidak pernah di file atau log
Audit kode
Keamanan Tauri
Allowlist command, CSP ketat, tidak ada akses shell dari frontend
Review konfigurasi
Privasi
Tanpa telemetri dan tanpa server GitHawk; data hanya keluar ke provider hosting atau AI yang dipilih pengguna
Kebijakan privasi
Keandalan
Operasi destruktif (reset hard, force push, delete branch) selalu bisa di-undo atau minta konfirmasi
Test end-to-end
Aksesibilitas
Navigasi penuh dengan keyboard, kontras tema memenuhi WCAG AA
Audit aksesibilitas
Pembaruan
Auto-update bertanda tangan (Tauri updater) dari GitHub Releases; bisa dimatikan
Test rilis
Lokalisasi
Bahasa Inggris dan Indonesia saat v1.0
Review UI
## 8. Arsitektur teknis (Rust + Tauri)
GitHawk memakai arsitektur hybrid: data repo dibaca cepat lewat libgit2 atau gitoxide, sedangkan semua operasi tulis yang berisiko dijalankan lewat git CLI resmi agar hooks, LFS, signing, dan credential helper bekerja persis seperti di terminal.
Frontend hanya menggambar dan mengirim perintah; semua logika Git, layout graph, dan akses kredensial ada di core Rust.
Pilihan crate dan pustaka
Komponen
Crate / pustaka
Fungsi
Shell aplikasi
tauri v2 + plugin updater, deep-link
Jendela, IPC, auto-update, githawk://
Baca repo
git2 (libgit2) atau gix (gitoxide)
Status, revwalk, diff, blame
Tulis repo
git CLI via tokio::process
Rebase, merge, push, LFS, hooks, signing
Async runtime
tokio
Proses paralel dan I/O non-blocking
File watcher
notify
Deteksi perubahan working tree
Terminal
portable-pty + xterm.js
Terminal dan sesi agen lintas OS
Pencarian fuzzy
nucleo
Fuzzy finder dan command palette
HTTP dan API hosting
reqwest, octocrab
GitHub, GitLab, Bitbucket, Azure DevOps
OAuth
oauth2 + deep link Tauri
Login provider via browser
Kredensial
keyring
Keychain macOS, Credential Manager Windows, Secret Service Linux
SSH key
ssh-key
Generate dan kelola kunci SSH
IPC bertipe
serde + tauri-specta
Tipe TypeScript otomatis dari Rust
Penyimpanan lokal
rusqlite
Cache graph, operation log, pengaturan
Frontend
React + TypeScript + Vite, Tailwind CSS, shadcn/ui
UI aplikasi
Editor
Monaco atau CodeMirror 6
Diff, konflik, edit cepat
Render graph
Canvas 2D atau WebGL (misalnya PixiJS)
Graph dengan virtual scroll
Keputusan desain utama
Baca dan tulis dipisah. libgit2 tidak menjalankan hooks dan tidak mendukung LFS, jadi operasi tulis selalu lewat git CLI.
Layout graph dihitung di Rust. Posisi lane dan warna dihitung di backend lalu dikirim per halaman, sehingga frontend tidak memegang seluruh riwayat.
Setiap operasi tulis dicatat. Sebelum operasi, core menyimpan snapshot ref ke operation log (SQLite); undo memakai log ini plus reflog.
Operasi panjang bisa dibatalkan. Clone, fetch, dan rebase mengirim event progres ke frontend dan mendukung pembatalan.
Abstraksi provider. Satu trait HostingProvider untuk keempat provider agar menambah provider baru tidak mengubah UI.
Frontend tanpa akses shell. Semua perintah lewat Tauri command yang di-allowlist.
### Spesifikasi visual commit graph
Commit graph mengikuti tata letak dan perilaku graph GitKraken: label branch di kiri, lane berwarna di tengah, pesan commit di kanan, dengan avatar author sebagai node. Palet warna dan ikon tetap milik GitHawk agar identitas visualnya berbeda.
Elemen
Perilaku dan tampilan
Tata letak baris
Tiga kolom yang bisa di-resize: label branch/tag, graph, pesan commit (plus kolom author dan tanggal opsional). Tinggi baris seragam, usulan 28 px
Lane
Satu warna per lane dari palet berurutan; garis vertikal 2 px; lane yang tidak lagi dipakai ditutup agar graph tetap sempit
Node commit
Avatar author berbentuk lingkaran (Gravatar, avatar provider, atau inisial) dengan cincin warna lane
Merge commit
Titik kecil warna lane tanpa avatar
Konektor
Garis turun dari node lalu berbelok dengan sudut membulat ke lane tujuan, bukan garis diagonal
Highlight baris
Pita semi-transparan warna lane dari node sampai kolom pesan; baris HEAD lebih kontras
Label branch
Pill berwarna lane, sejajar dengan commit ujungnya dan dihubungkan garis horizontal ke node. Ikon centang untuk branch aktif, ikon laptop untuk branch lokal, avatar atau ikon provider untuk remote
Label bertumpuk
Branch lokal dan remote di commit yang sama digabung dalam satu pill; kelebihan label ditampilkan sebagai +N
Drag and drop
Pill branch bisa di-drag; ghost label mengikuti kursor, lalu dilepas di branch lain untuk memunculkan menu merge, rebase, atau push
Baris WIP
Baris teratas berisi perubahan belum di-commit dengan node bergaris putus-putus
Interaksi
Klik memilih commit, Shift/Ctrl untuk multi-select, klik kanan membuka context menu, hover menampilkan tooltip detail
Hide dan solo
Lane branch yang disembunyikan memudar; mode solo hanya menampilkan riwayat branch terpilih
Implementasi frontend
Garis, node, dan pita highlight digambar di Canvas 2D (atau WebGL untuk repo sangat besar); avatar di-cache sebagai bitmap.
Label branch, teks pesan, dan kontrol interaktif berupa elemen HTML di atas canvas, memakai komponen shadcn/ui: Badge untuk pill, ContextMenu untuk klik kanan, Tooltip, HoverCard, Command untuk command palette, Resizable untuk kolom, dan ScrollArea.
Virtualisasi baris dengan @tanstack/react-virtual; canvas hanya menggambar baris yang terlihat.
Drag and drop label memakai dnd-kit.
Warna lane didefinisikan sebagai CSS variable di konfigurasi Tailwind agar tema terang dan gelap konsisten.
## 9. Roadmap dan milestone
Pengembangan dibagi empat fase yang mengikuti prioritas P0–P3; tiap fase baru dimulai setelah gerbang sebelumnya lolos. Spike commit graph dikerjakan paling awal karena risikonya tertinggi.
Fase 4 bergaris putus karena berisi fitur opsional yang dikerjakan sesuai permintaan komunitas. Tanggal tiap fase belum ditetapkan dan bergantung pada ukuran tim (lihat pertanyaan terbuka).
## 10. Metrik sukses
Keberhasilan v1.0 diukur dari adopsi komunitas dan bukti bahwa janji performa terpenuhi. Karena GitHawk tidak mengirim data apa pun, semua metrik diambil dari sumber publik atau CI. Angka target di bawah adalah usulan awal yang perlu divalidasi setelah beta.
Metrik
Target 6 bulan setelah v1.0
Sumber data
Unduhan
25.000
Halaman rilis dan store
Operasi Git sukses tanpa error
≥ 99,5%
Test end-to-end di CI
Target performa (bagian 7) terpenuhi
100% di CI
Benchmark otomatis
GitHub stars
5.000
GitHub
Kepuasan pengguna
Rating ≥ 4,5/5
Review dan diskusi di GitHub
## 11. Risiko dan mitigasi
Risiko terbesar ada di performa commit graph dan keandalan operasi tulis; keduanya ditangani sejak fase pertama, bukan di akhir.
Risiko
Dampak
Kemungkinan
Mitigasi
Commit graph lambat di repo besar
Tinggi
Sedang
Layout dihitung di Rust, kirim per halaman ke frontend, render Canvas/WebGL; benchmark sejak Fase 1
Perbedaan WebView antar OS (WebView2, WKWebView, WebKitGTK)
Sedang
Tinggi
Uji di matriks CI ketiga OS; hindari API web yang belum stabil di WebKitGTK
Operasi tulis merusak repo (rebase, reset, force push)
Tinggi
Rendah
Pakai git CLI resmi untuk operasi tulis, simpan snapshot ref sebelum operasi, undo berbasis reflog
libgit2 tidak mendukung LFS, hooks, dan sebagian fitur rebase
Sedang
Tinggi
Arsitektur hybrid: libgit2/gitoxide untuk baca, git CLI untuk tulis
Git tidak terpasang di mesin pengguna
Sedang
Sedang
Deteksi saat startup, tawarkan git yang dibundel atau panduan instalasi
Masalah autentikasi (SSH agent, credential helper, 2FA)
Tinggi
Tinggi
Delegasikan ke credential helper sistem dan ssh-agent; pesan error yang jelas
Sengketa nama atau merek "GitHawk"
Sedang
Rendah
Cek domain, GitHub org, dan PDKI sebelum rilis publik; siapkan nama cadangan
Kesan "jiplakan GitKraken"
Sedang
Sedang
Identitas visual dan tata letak sendiri; tidak menyalin aset atau teks
Rate limit atau perubahan API provider hosting
Sedang
Sedang
Lapisan abstraksi per provider, caching, penanganan rate limit
Scope creep mengejar semua fitur GitKraken
Tinggi
Tinggi
Prioritas P0–P3 dipegang ketat; fitur cloud dikeluarkan dari scope
## 12. Pertanyaan terbuka
Lisensi final: Apache-2.0 (permisif) atau GPL-3.0 (copyleft)?
Apakah nama "GitHawk" aman dipakai (domain, GitHub org, merek dagang)?
Bundel git di installer atau wajib pakai git sistem?
Frontend: sudah diputuskan React + Tailwind CSS + shadcn/ui.
Pustaka Git baca: git2 (libgit2, matang) atau gix (gitoxide, pure Rust dan lebih cepat tapi API belum lengkap)?
Provider AI default dan apakah perlu mendukung model lokal sejak awal?
Ukuran tim dan target tanggal untuk tiap milestone?