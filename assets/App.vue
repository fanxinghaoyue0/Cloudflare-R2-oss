<template>
  <div
    class="main"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <div v-if="dragActive" class="drag-overlay">松开即可上传到当前目录</div>

    <progress
      v-if="uploadProgress !== null"
      :value="uploadProgress"
      max="100"
    ></progress>

    <UploadPopup
      v-model="showUploadPopup"
      @upload="onUploadClicked"
      @createFolder="createFolder"
    ></UploadPopup>

    <header class="app-bar">
      <div class="bar-title-wrap">
        <strong class="bar-title">Cloudflare R2 文件库</strong>
        <div class="path-line">
          <button class="path-chip" @click="navigateTo('')">根目录</button>
          <template v-for="(segment, idx) in cwdSegments" :key="segment + idx">
            <span class="path-sep">/</span>
            <button class="path-chip" @click="navigateToByIndex(idx)">
              {{ segment }}
            </button>
          </template>
        </div>
      </div>

      <div class="app-tools">
        <div class="search-wrap">
          <input
            type="search"
            v-model.trim="search"
            placeholder="搜索文件或目录"
            aria-label="搜索"
          />
        </div>

        <button class="tool-btn" title="刷新" @click="fetchFiles(true)">
          刷新
        </button>

        <div class="menu-button">
          <button class="tool-btn" title="排序和操作" @click="showMenu = true">
            菜单
          </button>
          <Menu v-model="showMenu" :items="menuItems" @click="onMenuClick" />
        </div>
      </div>
    </header>

    <section class="status-row">
      <span>目录: <code>{{ displayCwd }}</code></span>
      <span>
        {{ filteredFolders.length }} 个目录 · {{ filteredFiles.length }} 个文件
      </span>
      <span v-if="clipboard">已复制: {{ clipboard.split('/').pop() }}</span>
      <span v-if="isUploading">
        上传中: {{ currentUploadingFile || '准备中...' }}
        <template v-if="uploadQueue.length">(队列 {{ uploadQueue.length }})</template>
      </span>
    </section>

    <section class="usage-card">
      <div class="usage-head">
        <strong>用量统计</strong>
        <button class="inline-action" @click="fetchUsageStats(true)">刷新统计</button>
      </div>
      <div v-if="usageLoading" class="usage-loading">统计中...</div>
      <div v-else-if="usageError" class="usage-error">{{ usageError }}</div>
      <template v-else-if="usageStats">
        <div class="usage-row">
          <span>总占用</span>
          <span>{{ formatSize(usageStats.totalBytes) }} / {{ formatSize(usageStats.quotaBytes) }}</span>
        </div>
        <div class="usage-progress">
          <div
            class="usage-progress-inner"
            :class="{ warn: usagePercent >= 80, danger: usagePercent >= 95 }"
            :style="{ width: `${Math.min(100, usagePercent)}%` }"
          ></div>
        </div>
        <div class="usage-row">
          <span>占比</span>
          <span>{{ usagePercent.toFixed(1) }}%</span>
        </div>
        <div class="usage-row">
          <span>计费周期</span>
          <span>{{ usageStats.cycleStartDate }} 起</span>
        </div>
        <div class="usage-row">
          <span>本周期新增</span>
          <span>{{ formatSize(usageStats.cycleUploadBytes) }} · {{ usageStats.cycleUploadCount }} 个文件</span>
        </div>
        <div class="usage-row">
          <span>总文件数</span>
          <span>{{ usageStats.totalObjects }} 个</span>
        </div>
      </template>
    </section>

    <section v-if="selectedKeys.length" class="batch-bar">
      <span>已选择 {{ selectedKeys.length }} 个文件</span>
      <div class="batch-actions">
        <button class="inline-action" @click="selectAllVisible">全选当前列表</button>
        <button class="inline-action" @click="clearSelection">清空选择</button>
        <button class="inline-action" @click="batchDownload">批量下载</button>
        <button class="inline-action" @click="batchCopy">批量复制</button>
        <button class="inline-action" @click="batchMove">批量移动</button>
        <button class="inline-action danger" @click="batchDelete">批量删除</button>
      </div>
    </section>

    <ul class="file-list">
      <li v-if="cwd !== ''">
        <button
          type="button"
          class="file-item file-item-folder"
          @click="navigateUp"
          @contextmenu.prevent
        >
          <div class="file-icon folder-icon">📁</div>
          <span class="file-name">..</span>
        </button>
      </li>

      <li v-for="folder in filteredFolders" :key="folder">
        <div
          class="file-item file-item-folder"
          @click="navigateTo(folder)"
          @contextmenu.prevent="openContextMenu(folder)"
        >
          <div class="file-icon folder-icon">📁</div>
          <span class="file-name">{{ folderName(folder) }}</span>
          <button class="item-action" @click.stop="openContextMenu(folder)">···</button>
        </div>
      </li>

      <li v-for="file in filteredFiles" :key="file.key">
        <div
          class="file-item"
          @click="previewFile(file)"
          @contextmenu.prevent="openContextMenu(file)"
        >
          <input
            class="select-box"
            type="checkbox"
            :checked="isSelected(file.key)"
            @click.stop
            @change="toggleSelected(file.key)"
            :aria-label="`选择 ${file.key}`"
          />
          <MimeIcon
            :content-type="file.httpMetadata?.contentType || ''"
            :thumbnail="
              file.customMetadata?.thumbnail
                ? `/raw/_$flaredrive$/thumbnails/${file.customMetadata.thumbnail}.png`
                : null
            "
          />
          <div class="file-content">
            <div class="file-name">{{ file.key.split('/').pop() }}</div>
            <div class="file-attr">
              <span>{{ new Date(file.uploaded).toLocaleString() }}</span>
              <span>{{ formatSize(file.size) }}</span>
              <span>{{ file.httpMetadata?.contentType || 'unknown' }}</span>
            </div>
          </div>
          <button class="item-action" @click.stop="openContextMenu(file)">···</button>
        </div>
      </li>
    </ul>

    <div v-if="loading" class="page-tip">加载中...</div>
    <div v-else-if="fetchError" class="page-tip error-tip">
      <span>{{ fetchError }}</span>
      <button class="inline-action" @click="fetchFiles(true)">重试</button>
    </div>
    <div v-else-if="!filteredFiles.length && !filteredFolders.length" class="page-tip">
      没有文件
    </div>

    <Dialog v-model="showPreviewDialog">
      <div class="preview-dialog" @click.stop>
        <div class="preview-head">
          <strong class="preview-name">{{ previewName }}</strong>
          <div class="preview-actions">
            <a
              v-if="previewUrl"
              class="inline-action"
              :href="previewUrl"
              target="_blank"
              rel="noopener"
            >
              新窗口打开
            </a>
          </div>
        </div>

        <div class="preview-body">
          <div v-if="previewLoading" class="page-tip">预览加载中...</div>
          <div v-else-if="previewError" class="page-tip error-tip">{{ previewError }}</div>

          <img
            v-else-if="previewType === 'image'"
            :src="previewUrl"
            alt="image preview"
            class="preview-media"
          />

          <video
            v-else-if="previewType === 'video'"
            :src="previewUrl"
            controls
            class="preview-media"
          ></video>

          <audio
            v-else-if="previewType === 'audio'"
            :src="previewUrl"
            controls
            class="preview-audio"
          ></audio>

          <iframe
            v-else-if="previewType === 'pdf'"
            :src="previewUrl"
            class="preview-pdf"
            title="pdf preview"
          ></iframe>

          <pre v-else-if="previewType === 'json'" class="preview-text">{{ previewContent }}</pre>
          <pre v-else-if="previewType === 'markdown'" class="preview-text">{{ previewContent }}</pre>
          <pre v-else-if="previewType === 'text'" class="preview-text">{{ previewContent }}</pre>

          <div v-else class="page-tip">
            暂不支持该格式内置预览，请使用“新窗口打开”。
          </div>
        </div>
      </div>
    </Dialog>

    <Dialog v-model="showContextMenu">
      <div
        v-text="focusedItem?.key || focusedItem || ''"
        class="contextmenu-filename"
        @click.stop.prevent
      ></div>

      <ul v-if="typeof focusedItem === 'string'" class="contextmenu-list">
        <li>
          <button @click="copyFolderLink(focusedItem)">复制链接</button>
        </li>
        <li>
          <button @click="downloadFolderAsZip(focusedItem)">打包下载</button>
        </li>
        <li>
          <button style="color: #a10" @click="removeFolder(focusedItem)">删除目录</button>
        </li>
      </ul>

      <ul v-else-if="focusedItem" class="contextmenu-list">
        <li>
          <button @click="renameFile(focusedItem.key)">重命名</button>
        </li>
        <li>
          <a :href="`/raw/${focusedItem.key}`" target="_blank" download>下载</a>
        </li>
        <li>
          <button @click="copyFileKey(focusedItem.key)">复制</button>
        </li>
        <li>
          <button @click="copyLink(`/raw/${focusedItem.key}`)">复制链接</button>
        </li>
        <li>
          <button @click="previewFile(focusedItem)">预览</button>
        </li>
        <li>
          <button style="color: #a10" @click="removeFile(focusedItem.key)">删除</button>
        </li>
      </ul>
    </Dialog>

    <button class="upload-button circle" @click="showUploadPopup = true" title="上传文件">
      上传
    </button>

    <Transition name="fade">
      <div v-if="toast" class="toast" :class="`toast-${toastType}`">{{ toast }}</div>
    </Transition>
  </div>
</template>

<script>
import {
  generateThumbnail,
  blobDigest,
  multipartUpload,
  SIZE_LIMIT,
} from "/assets/main.mjs";
import Dialog from "./Dialog.vue";
import Menu from "./Menu.vue";
import MimeIcon from "./MimeIcon.vue";
import UploadPopup from "./UploadPopup.vue";

const TEXT_PREVIEW_LIMIT = 2 * 1024 * 1024;

export default {
  data: () => ({
    cwd: new URL(window.location).searchParams.get("p") || "",
    files: [],
    folders: [],
    clipboard: null,
    focusedItem: null,
    loading: false,
    fetchError: "",
    search: "",
    sortMode: "nameAsc",
    showContextMenu: false,
    showMenu: false,
    showUploadPopup: false,
    uploadProgress: null,
    uploadQueue: [],
    isUploading: false,
    currentUploadingFile: "",
    dragDepth: 0,
    dragActive: false,
    toast: "",
    toastType: "info",
    toastTimer: null,
    popstateHandler: null,
    selectedKeys: [],
    showPreviewDialog: false,
    previewLoading: false,
    previewType: "unsupported",
    previewContent: "",
    previewError: "",
    previewUrl: "",
    previewName: "",
    usageLoading: false,
    usageError: "",
    usageStats: null,
  }),

  computed: {
    displayCwd() {
      return this.cwd || "/";
    },

    cwdSegments() {
      if (!this.cwd) return [];
      return this.cwd.split("/").filter(Boolean);
    },

    menuItems() {
      return [
        { text: "名称 A-Z" },
        { text: "名称 Z-A" },
        { text: "时间 新->旧" },
        { text: "时间 旧->新" },
        { text: "大小 小->大" },
        { text: "大小 大->小" },
        { text: "粘贴" },
      ];
    },

    filteredFolders() {
      const keyword = this.search.toLowerCase();
      let folders = this.folders;
      if (keyword) {
        folders = folders.filter((folder) =>
          this.folderName(folder).toLowerCase().includes(keyword)
        );
      }
      return [...folders].sort((a, b) =>
        this.folderName(a).localeCompare(this.folderName(b), "zh-Hans-CN")
      );
    },

    filteredFiles() {
      const keyword = this.search.toLowerCase();
      let files = this.files;
      if (keyword) {
        files = files.filter((file) =>
          file.key.split("/").pop().toLowerCase().includes(keyword)
        );
      }
      return [...files].sort((a, b) => this.compareFiles(a, b));
    },

    selectedFiles() {
      const selectedSet = new Set(this.selectedKeys);
      return this.files.filter((file) => selectedSet.has(file.key));
    },

    usagePercent() {
      if (!this.usageStats || !this.usageStats.quotaBytes) return 0;
      return (this.usageStats.totalBytes / this.usageStats.quotaBytes) * 100;
    },
  },

  methods: {
    folderName(folder) {
      return folder.match(/.*?([^/]*)\/?$/)?.[1] || folder;
    },

    compareFiles(a, b) {
      if (this.sortMode === "nameDesc") {
        return b.key.localeCompare(a.key, "zh-Hans-CN");
      }
      if (this.sortMode === "timeDesc") {
        return new Date(b.uploaded).valueOf() - new Date(a.uploaded).valueOf();
      }
      if (this.sortMode === "timeAsc") {
        return new Date(a.uploaded).valueOf() - new Date(b.uploaded).valueOf();
      }
      if (this.sortMode === "sizeAsc") {
        return a.size - b.size;
      }
      if (this.sortMode === "sizeDesc") {
        return b.size - a.size;
      }
      return a.key.localeCompare(b.key, "zh-Hans-CN");
    },

    notify(message, type = "info") {
      this.toast = message;
      this.toastType = type;
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => {
        this.toast = "";
      }, 2200);
    },

    async fetchUsageStats(force = false) {
      this.usageLoading = true;
      this.usageError = "";
      try {
        const response = await fetch(`/api/stats/usage${force ? "?refresh=1" : ""}`, {
          cache: force ? "reload" : "default",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.usageStats = await response.json();
      } catch (error) {
        this.usageError = "用量统计加载失败";
      } finally {
        this.usageLoading = false;
      }
    },

    ensureAuthRedirect() {
      fetch("/api/write/")
        .then((value) => {
          if (value.redirected) window.location.href = value.url;
        })
        .catch(() => {});
    },

    isSelected(key) {
      return this.selectedKeys.includes(key);
    },

    toggleSelected(key) {
      if (this.isSelected(key)) {
        this.selectedKeys = this.selectedKeys.filter((item) => item !== key);
      } else {
        this.selectedKeys = [...this.selectedKeys, key];
      }
    },

    selectAllVisible() {
      this.selectedKeys = this.filteredFiles.map((file) => file.key);
    },

    clearSelection() {
      this.selectedKeys = [];
    },

    async batchDelete() {
      if (!this.selectedKeys.length) return;
      if (!window.confirm(`确定批量删除 ${this.selectedKeys.length} 个文件吗？`)) return;

      let success = 0;
      for (const key of this.selectedKeys) {
        try {
          await axios.delete(`/api/write/items/${key}`);
          success += 1;
        } catch (error) {
          this.ensureAuthRedirect();
        }
      }
      this.notify(`批量删除完成: ${success}/${this.selectedKeys.length}`);
      this.clearSelection();
      await this.fetchFiles();
      await this.fetchUsageStats();
    },

    async batchDownload() {
      if (!this.selectedKeys.length) return;
      if (!window.JSZip) {
        this.notify("缺少 JSZip 依赖，无法批量下载", "error");
        return;
      }

      const zip = new window.JSZip();
      let success = 0;

      this.notify(`开始打包 ${this.selectedKeys.length} 个文件...`);

      for (const key of this.selectedKeys) {
        const filename = key.split("/").pop() || key;
        try {
          const response = await fetch(`/raw/${this.encodeObjectPath(key)}`);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          zip.file(filename, blob);
          success += 1;
        } catch (error) {
          console.log("Batch download item failed", key, error);
        }
      }

      if (!success) {
        this.notify("批量下载失败：没有可打包的文件", "error");
        return;
      }

      try {
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `download-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.notify(`批量下载完成: ${success}/${this.selectedKeys.length}`);
      } catch (error) {
        this.notify("ZIP 生成失败", "error");
      }
    },

    async downloadFolderAsZip(folder) {
      if (!window.JSZip) {
        this.notify("缺少 JSZip 依赖，无法打包下载", "error");
        return;
      }
      this.showContextMenu = false;

      const rootFolderName = this.folderName(folder) || "folder";
      const zip = new window.JSZip();
      const rootZipFolder = zip.folder(rootFolderName);
      let success = 0;

      this.notify(`正在打包目录: ${rootFolderName}`);

      const collectFiles = async (prefix, zipFolder) => {
        const path = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
        const encodedPath = this.encodeObjectPath(path);
        const response = await fetch(`/api/children/${encodedPath}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        for (const file of data.value || []) {
          const rawResponse = await fetch(`/raw/${this.encodeObjectPath(file.key)}`);
          if (!rawResponse.ok) continue;
          const blob = await rawResponse.blob();
          const fileName = file.key.split("/").pop() || file.key;
          zipFolder.file(fileName, blob);
          success += 1;
        }

        for (const subFolder of data.folders || []) {
          const subName = this.folderName(subFolder) || "folder";
          const childZipFolder = zipFolder.folder(subName);
          await collectFiles(subFolder, childZipFolder);
        }
      };

      try {
        await collectFiles(folder, rootZipFolder);
        if (!success) {
          this.notify("目录中没有可下载文件", "error");
          return;
        }
        const zipBlob = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${rootFolderName}-${new Date()
          .toISOString()
          .slice(0, 19)
          .replace(/[:T]/g, "-")}.zip`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.notify(`目录打包完成: ${success} 个文件`);
      } catch (error) {
        console.log("Folder zip download failed", error);
        this.notify("目录打包下载失败", "error");
      }
    },

    async batchCopy() {
      if (!this.selectedKeys.length) return;
      const targetInput = window.prompt("复制到目录(留空表示当前目录):", this.cwd || "");
      if (targetInput === null) return;
      const targetDir = this.normalizeTargetDir(targetInput);

      let success = 0;
      for (const key of this.selectedKeys) {
        const name = key.split("/").pop();
        try {
          await this.copyPaste(key, `${targetDir}${name}`);
          success += 1;
        } catch (error) {
          this.ensureAuthRedirect();
        }
      }
      this.notify(`批量复制完成: ${success}/${this.selectedKeys.length}`);
      await this.fetchFiles();
      await this.fetchUsageStats();
    },

    async batchMove() {
      if (!this.selectedKeys.length) return;
      const targetInput = window.prompt("移动到目录(留空表示当前目录):", this.cwd || "");
      if (targetInput === null) return;
      const targetDir = this.normalizeTargetDir(targetInput);

      let success = 0;
      for (const key of this.selectedKeys) {
        const name = key.split("/").pop();
        try {
          await this.copyPaste(key, `${targetDir}${name}`);
          await axios.delete(`/api/write/items/${key}`);
          success += 1;
        } catch (error) {
          this.ensureAuthRedirect();
        }
      }
      this.notify(`批量移动完成: ${success}/${this.selectedKeys.length}`);
      this.clearSelection();
      await this.fetchFiles();
      await this.fetchUsageStats();
    },

    normalizeTargetDir(value) {
      const trimmed = value.trim().replace(/^\/+/, "");
      if (!trimmed) return this.normalizeCwd(this.cwd);
      return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
    },

    encodeObjectPath(path) {
      return path
        .split("/")
        .filter((part) => part !== "")
        .map((part) => encodeURIComponent(part))
        .join("/");
    },

    detectPreviewType(file) {
      const contentType = (file.httpMetadata?.contentType || "").toLowerCase();
      const lowerName = file.key.toLowerCase();

      if (contentType.startsWith("image/")) return "image";
      if (contentType.startsWith("video/")) return "video";
      if (contentType.startsWith("audio/")) return "audio";
      if (contentType === "application/pdf" || lowerName.endsWith(".pdf")) return "pdf";
      if (contentType.includes("json") || lowerName.endsWith(".json")) return "json";
      if (
        lowerName.endsWith(".md") ||
        lowerName.endsWith(".markdown") ||
        contentType.includes("markdown")
      ) {
        return "markdown";
      }
      if (
        contentType.startsWith("text/") ||
        /\.(txt|log|csv|xml|html|css|js|ts|vue|yml|yaml|ini|conf|sh)$/i.test(lowerName)
      ) {
        return "text";
      }
      return "unsupported";
    },

    async previewFile(file) {
      this.showContextMenu = false;
      this.previewName = file.key.split("/").pop();
      this.previewUrl = `/raw/${file.key}`;
      this.previewType = this.detectPreviewType(file);
      this.previewLoading = false;
      this.previewContent = "";
      this.previewError = "";
      this.showPreviewDialog = true;

      if (!["text", "json", "markdown"].includes(this.previewType)) return;
      if (file.size > TEXT_PREVIEW_LIMIT) {
        this.previewError = "文本文件超过 2MB，请使用新窗口打开。";
        return;
      }

      this.previewLoading = true;
      try {
        const response = await fetch(this.previewUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (this.previewType === "json") {
          try {
            this.previewContent = JSON.stringify(JSON.parse(text), null, 2);
          } catch (error) {
            this.previewContent = text;
          }
        } else {
          this.previewContent = text;
        }
      } catch (error) {
        this.previewError = "预览加载失败";
      } finally {
        this.previewLoading = false;
      }
    },

    async copyLink(link) {
      const url = new URL(link, window.location.origin);
      try {
        await navigator.clipboard.writeText(url.toString());
        this.notify("链接已复制");
      } catch (error) {
        window.prompt("复制失败，请手动复制", url.toString());
      }
      this.showContextMenu = false;
    },

    copyFolderLink(folder) {
      this.copyLink(`/?p=${encodeURIComponent(folder)}`);
    },

    copyFileKey(key) {
      this.clipboard = key;
      this.notify(`已复制文件: ${key.split("/").pop()}`);
      this.showContextMenu = false;
    },

    async copyPaste(source, target) {
      const uploadUrl = `/api/write/items/${target}`;
      await axios.put(uploadUrl, "", {
        headers: { "x-amz-copy-source": encodeURIComponent(source) },
      });
    },

    normalizeName(name) {
      return name.replace(/^\/+|\/+$/g, "").trim();
    },

    async createFolder() {
      try {
        const folderName = this.normalizeName(window.prompt("请输入文件夹名称") || "");
        if (!folderName) return;
        this.showUploadPopup = false;
        const uploadUrl = `/api/write/items/${this.cwd}${folderName}/_$folder$`;
        await axios.put(uploadUrl, "");
        await this.fetchFiles();
        await this.fetchUsageStats();
        this.notify("目录创建成功");
      } catch (error) {
        this.ensureAuthRedirect();
        this.notify("目录创建失败", "error");
      }
    },

    async fetchFiles(force = false) {
      this.files = [];
      this.folders = [];
      this.fetchError = "";
      this.loading = true;
      this.clearSelection();

      try {
        const response = await fetch(`/api/children/${this.cwd}`, {
          cache: force ? "reload" : "default",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        this.files = result.value || [];
        this.folders = result.folders || [];
      } catch (error) {
        this.fetchError = "文件列表加载失败";
      } finally {
        this.loading = false;
      }
    },

    formatSize(size) {
      const units = ["B", "KB", "MB", "GB", "TB"];
      let value = size;
      let i = 0;
      while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i += 1;
      }
      return `${value.toFixed(1)} ${units[i]}`;
    },

    onDragEnter() {
      this.dragDepth += 1;
      this.dragActive = true;
    },

    onDragLeave() {
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.dragActive = false;
    },

    onDrop(ev) {
      this.dragDepth = 0;
      this.dragActive = false;
      let files;
      if (ev.dataTransfer.items) {
        files = [...ev.dataTransfer.items]
          .filter((item) => item.kind === "file")
          .map((item) => item.getAsFile())
          .filter(Boolean);
      } else {
        files = ev.dataTransfer.files;
      }
      this.uploadFiles(files);
    },

    onMenuClick(text) {
      switch (text) {
        case "名称 A-Z":
          this.sortMode = "nameAsc";
          return;
        case "名称 Z-A":
          this.sortMode = "nameDesc";
          return;
        case "时间 新->旧":
          this.sortMode = "timeDesc";
          return;
        case "时间 旧->新":
          this.sortMode = "timeAsc";
          return;
        case "大小 小->大":
          this.sortMode = "sizeAsc";
          return;
        case "大小 大->小":
          this.sortMode = "sizeDesc";
          return;
        case "粘贴":
          this.pasteFile();
          return;
        default:
          return;
      }
    },

    onUploadClicked(fileElement) {
      if (!fileElement.value) return;
      this.uploadFiles(fileElement.files);
      this.showUploadPopup = false;
      fileElement.value = null;
    },

    async pasteFile() {
      if (!this.clipboard) {
        this.notify("剪贴板为空", "error");
        return;
      }
      let newName = window.prompt("粘贴后文件名:");
      if (newName === null) return;
      newName = this.normalizeName(newName);
      if (!newName) newName = this.clipboard.split("/").pop();

      try {
        await this.copyPaste(this.clipboard, `${this.cwd}${newName}`);
        await this.fetchFiles();
        this.notify("粘贴完成");
      } catch (error) {
        this.ensureAuthRedirect();
        this.notify("粘贴失败", "error");
      }
    },

    async processUploadQueue() {
      if (this.isUploading) return;
      if (!this.uploadQueue.length) return;

      this.isUploading = true;
      this.uploadProgress = 0;

      try {
        while (this.uploadQueue.length) {
          const { basedir, file } = this.uploadQueue.shift();
          this.currentUploadingFile = file.name;
          let thumbnailDigest = null;

          if (file.type.startsWith("image/") || file.type === "video/mp4") {
            try {
              const thumbnailBlob = await generateThumbnail(file);
              const digestHex = await blobDigest(thumbnailBlob);
              const thumbnailUploadUrl = `/api/write/items/_$flaredrive$/thumbnails/${digestHex}.png`;
              await axios.put(thumbnailUploadUrl, thumbnailBlob);
              thumbnailDigest = digestHex;
            } catch (error) {
              console.log("Generate or upload thumbnail failed", error);
            }
          }

          const headers = {};
          if (thumbnailDigest) headers["fd-thumbnail"] = thumbnailDigest;

          const onUploadProgress = (progressEvent) => {
            const percentCompleted = (progressEvent.loaded * 100) / progressEvent.total;
            this.uploadProgress = Math.min(100, Math.round(percentCompleted));
          };

          try {
            if (file.size >= SIZE_LIMIT) {
              await multipartUpload(`${basedir}${file.name}`, file, {
                headers,
                onUploadProgress,
              });
            } else {
              await axios.put(`/api/write/items/${basedir}${file.name}`, file, {
                headers,
                onUploadProgress,
              });
            }
          } catch (error) {
            this.ensureAuthRedirect();
            this.notify(`上传失败: ${file.name}`, "error");
          }
        }
      } finally {
        this.isUploading = false;
        this.currentUploadingFile = "";
        this.uploadProgress = null;
        await this.fetchFiles();
        await this.fetchUsageStats();
      }
    },

    async removeFile(key) {
      if (!window.confirm(`确定要删除 ${key} 吗？`)) return;
      try {
        await axios.delete(`/api/write/items/${key}`);
        await this.fetchFiles();
        await this.fetchUsageStats();
        this.notify("删除成功");
      } catch (error) {
        this.ensureAuthRedirect();
        this.notify("删除失败", "error");
      } finally {
        this.showContextMenu = false;
      }
    },

    async removeFolder(folder) {
      await this.removeFile(folder + "_$folder$");
    },

    async renameFile(key) {
      const newName = this.normalizeName(window.prompt("重命名为:") || "");
      if (!newName) return;
      try {
        await this.copyPaste(key, `${this.cwd}${newName}`);
        await axios.delete(`/api/write/items/${key}`);
        await this.fetchFiles();
        await this.fetchUsageStats();
        this.notify("重命名成功");
      } catch (error) {
        this.ensureAuthRedirect();
        this.notify("重命名失败", "error");
      } finally {
        this.showContextMenu = false;
      }
    },

    normalizeCwd(value) {
      if (!value) return "";
      return value.endsWith("/") ? value : `${value}/`;
    },

    uploadFiles(files) {
      if (!files || !files.length) return;
      const basedir = this.normalizeCwd(this.cwd);

      const uploadTasks = Array.from(files).map((file) => ({ basedir, file }));
      this.uploadQueue.push(...uploadTasks);
      this.notify(`已加入队列: ${uploadTasks.length} 个文件`);
      this.processUploadQueue();
    },

    openContextMenu(item) {
      this.focusedItem = item;
      this.showContextMenu = true;
    },

    navigateUp() {
      this.cwd = this.cwd.replace(/[^/]+\/$/, "");
    },

    navigateTo(path) {
      this.cwd = path;
    },

    navigateToByIndex(index) {
      const segments = this.cwdSegments.slice(0, index + 1);
      this.cwd = `${segments.join("/")}/`;
    },
  },

  watch: {
    cwd: {
      handler() {
        this.fetchFiles();
        const url = new URL(window.location);
        if ((url.searchParams.get("p") || "") !== this.cwd) {
          this.cwd ? url.searchParams.set("p", this.cwd) : url.searchParams.delete("p");
          window.history.pushState(null, "", url.toString());
        }
        document.title = `${this.cwd.replace(/.*\/(?!$)|\//g, "") || "/"} - 文件库`;
      },
      immediate: true,
    },
  },

  created() {
    this.fetchUsageStats();
    this.popstateHandler = () => {
      const searchParams = new URL(window.location).searchParams;
      if (searchParams.get("p") !== this.cwd) this.cwd = searchParams.get("p") || "";
    };
    window.addEventListener("popstate", this.popstateHandler);
  },

  unmounted() {
    if (this.popstateHandler) {
      window.removeEventListener("popstate", this.popstateHandler);
    }
    if (this.toastTimer) clearTimeout(this.toastTimer);
  },

  components: {
    Dialog,
    Menu,
    MimeIcon,
    UploadPopup,
  },
};
</script>

<style>
.main {
  min-height: 100%;
  position: relative;
  padding-bottom: 84px;
}

.drag-overlay {
  position: fixed;
  inset: 0;
  z-index: 20;
  background: rgba(20, 120, 120, 0.2);
  color: #0b4040;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  font-weight: 700;
  backdrop-filter: blur(1px);
}

.app-bar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(17, 24, 39, 0.08);
  background: rgba(250, 252, 255, 0.9);
  backdrop-filter: blur(8px);
}

.bar-title-wrap {
  min-width: 0;
}

.bar-title {
  display: block;
  font-size: 15px;
  margin-bottom: 6px;
}

.path-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

.path-chip {
  padding: 3px 8px;
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(12, 74, 110, 0.2);
  background: rgba(255, 255, 255, 0.86);
}

.path-sep {
  color: #6b7280;
}

.app-tools {
  display: flex;
  gap: 8px;
  align-items: center;
}

.search-wrap {
  min-width: 180px;
}

.menu-button {
  display: flex;
  position: relative;
}

.tool-btn,
.inline-action,
.item-action {
  border: 1px solid rgba(17, 24, 39, 0.15);
  border-radius: 10px;
  background: #fff;
  padding: 7px 10px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.tool-btn:hover,
.inline-action:hover,
.item-action:hover,
.path-chip:hover {
  background: #ecf7ff;
  border-color: rgba(8, 97, 158, 0.35);
}

.status-row {
  margin: 12px 16px 10px;
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  color: #46576d;
  font-size: 13px;
}

.status-row code {
  background: rgba(12, 74, 110, 0.08);
  border-radius: 4px;
  padding: 0 4px;
}

.usage-card {
  margin: 0 16px 10px;
  padding: 12px;
  border-radius: 12px;
  border: 1px solid rgba(17, 24, 39, 0.12);
  background: #fff;
}

.usage-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.usage-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  font-size: 13px;
  color: #334155;
}

.usage-progress {
  margin-top: 8px;
  height: 10px;
  border-radius: 999px;
  background: #e2e8f0;
  overflow: hidden;
}

.usage-progress-inner {
  height: 100%;
  background: linear-gradient(90deg, #14b8a6, #0d9488);
  transition: width 0.2s ease;
}

.usage-progress-inner.warn {
  background: linear-gradient(90deg, #f59e0b, #d97706);
}

.usage-progress-inner.danger {
  background: linear-gradient(90deg, #ef4444, #b91c1c);
}

.usage-loading,
.usage-error {
  color: #475569;
  font-size: 13px;
}

.usage-error {
  color: #991b1b;
}

.batch-bar {
  margin: 0 16px 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(14, 165, 164, 0.1);
  border: 1px solid rgba(13, 148, 136, 0.2);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}

.batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.danger {
  border-color: rgba(161, 16, 16, 0.35);
  color: #a10;
}

.file-item {
  position: relative;
}

.select-box {
  margin-left: 12px;
  margin-right: 4px;
}

.file-content {
  min-width: 0;
}

.file-item-folder {
  width: 100%;
  text-align: left;
}

.folder-icon {
  font-size: 24px;
}

.item-action {
  margin-left: auto;
  padding: 6px 10px;
  color: #4b5563;
}

.page-tip {
  margin: 16px;
  text-align: center;
  color: #4b5563;
}

.error-tip {
  color: #912121;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
}

.preview-dialog {
  width: min(88vw, 960px);
  max-height: 80vh;
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.preview-head {
  padding: 12px;
  border-bottom: 1px solid rgba(17, 24, 39, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.preview-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-body {
  padding: 12px;
  overflow: auto;
}

.preview-media {
  max-width: 100%;
  max-height: calc(80vh - 120px);
  border-radius: 8px;
}

.preview-audio {
  width: 100%;
}

.preview-pdf {
  width: 100%;
  min-height: 65vh;
  border: 1px solid rgba(17, 24, 39, 0.15);
  border-radius: 8px;
}

.preview-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  font-size: 13px;
  background: #f8fafc;
  border-radius: 8px;
  padding: 12px;
}

.contextmenu-filename {
  padding: 12px;
  min-width: 256px;
  max-width: min(70vw, 500px);
}

.contextmenu-list > li > * {
  display: block;
  width: 100%;
  padding: 12px;
  text-align: left;
  transition: background-color 0.2s ease-in-out;
  font-size: inherit;
}

.contextmenu-list > li > *:hover {
  background-color: #eef6ff;
}

.upload-button {
  position: fixed;
  right: 18px;
  bottom: 18px;
  min-width: 58px;
  height: 58px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  letter-spacing: 0.2px;
  background: linear-gradient(130deg, #0ea5a4, #0d9488);
  color: #fff;
  cursor: pointer;
  box-shadow: 0 12px 24px rgba(13, 148, 136, 0.28);
  border: none;
}

button.circle {
  border-radius: 50%;
}

progress {
  position: fixed;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 5px;
  z-index: 25;
}

.toast {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 22px;
  padding: 10px 14px;
  border-radius: 10px;
  color: #fff;
  background: rgba(17, 24, 39, 0.92);
  z-index: 30;
}

.toast-error {
  background: rgba(153, 27, 27, 0.94);
}

@media (max-width: 820px) {
  .app-bar {
    align-items: stretch;
  }

  .app-tools {
    width: 100%;
  }

  .search-wrap {
    flex: 1;
  }

  .tool-btn {
    white-space: nowrap;
  }

  .status-row {
    margin-top: 8px;
    font-size: 12px;
  }

  .preview-dialog {
    width: 94vw;
  }
}
</style>
