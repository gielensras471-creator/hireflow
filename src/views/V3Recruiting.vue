<template>
  <section
    ref="detailRoot"
    class="v3-recruiting"
    :class="{ 'v4-recruiting-list': !isDetail, 'v4-detail': isDetail }"
  >
    <header v-if="isDetail" class="v4-detail-heading">
      <button class="v4-text-button" type="button" @click="backToApplications">
        ←
        {{
          safeReturn(route.query.fromPosition).startsWith('/positions/')
            ? '返回职位详情'
            : '返回候选人管理'
        }}
      </button>
      <h1 class="v4-detail-sr" tabindex="-1">申请详情</h1>
      <div v-if="application" class="v4-detail-heading-row">
        <div>
          <div class="v4-detail-identity">
            <h2>{{ application.name || '姓名未记录' }}</h2>
            <span class="v3-state-label">申请 #{{ application.id }}</span>
            <span class="v3-state-label" :data-state="application.applicationStatus">{{
              label(application.applicationStatus)
            }}</span>
          </div>
          <p>
            {{ application.positionTitle || '职位名称未记录' }} · #{{ application.positionId }} ·
            业务负责人 · {{ application.owner || '未记录' }}
          </p>
        </div>
        <div class="v4-detail-header-actions">
          <el-button :disabled="loading" @click="load">刷新详情</el-button>
          <el-button
            :disabled="
              detailBlocked || !!gate.current.value || application.applicationStatus !== 'active'
            "
            @click="openEditor($event, application)"
            >编辑申请资料</el-button
          >
        </div>
      </div>
      <h2 v-else>申请详情</h2>
    </header>
    <header v-else class="v3-page-heading">
      <div>
        <h1 tabindex="-1">{{ positions ? '职位管理' : '候选人管理' }}</h1>
        <p>
          {{ positions ? '维护职位信息，查看各职位的招聘申请' : '招聘申请工作台' }}
        </p>
      </div>
      <el-button
        v-if="!isDetail"
        class="v4-create-button"
        type="primary"
        :disabled="loading || !!gate.current.value"
        @click="openEditor($event, null)"
        >＋ {{ positions ? '新建职位' : '添加申请' }}</el-button
      >
    </header>
    <div v-if="positions" class="v4-position-metrics" aria-label="职位统计，包含已归档记录">
      <span><i data-state="open" />开放职位 {{ positionCounts.open ?? '—' }}</span>
      <span><i />已关闭职位 {{ positionCounts.closed ?? '—' }}</span>
      <small>按职位状态统计，包含已归档记录</small>
    </div>
    <form
      v-if="!isDetail"
      class="v3-filters v3-filter-toolbar v4-list-tools"
      @submit.prevent="filter"
    >
      <div class="v4-search-box">
        <button type="submit" aria-label="筛选" title="搜索">
          <svg
            width="18"
            height="18"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            aria-hidden="true"
          >
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="m13 13 4 4" />
          </svg>
        </button>
        <input
          id="recruiting-search"
          v-model="search"
          aria-label="搜索"
          :placeholder="positions ? '搜索职位名称、部门或地点' : '搜索姓名、负责人或职位'"
        />
      </div>
      <V3FilterSelect
        v-if="positions"
        id="position-status"
        :model-value="status"
        label="职位状态"
        all-label="状态：全部"
        :options="{ open: '招聘中', closed: '已关闭' }"
        @update:model-value="applyStatus"
      />
      <template v-else>
        <V3FilterSelect
          v-if="!historyPositionIssue"
          id="recruiting-position-id"
          :model-value="positionFilter"
          label="职位"
          all-label="职位：全部职位"
          :options="historyPositionOptions"
          @update:model-value="applyPosition"
        />
        <div v-else class="v3-filter-field">
          <label for="recruiting-position-fallback">职位 ID</label>
          <input
            id="recruiting-position-fallback"
            v-model="positionFilter"
            type="number"
            min="1"
            aria-label="职位 ID"
            placeholder="输入职位 ID"
          />
        </div>
        <V3FilterSelect
          id="application-status"
          :model-value="status"
          label="申请状态"
          :options="{ active: '进行中', closed: '已结束', all: '全部申请状态' }"
          @update:model-value="applyStatus"
        />
        <V3FilterSelect
          id="application-stage"
          :model-value="stage"
          label="阶段"
          all-label="阶段：全部阶段"
          :options="stageOptions"
          @update:model-value="applyStage"
        />
      </template>
      <div v-if="positions" class="v3-filter-field">
        <label for="v4-position-sort">排序</label>
        <select id="v4-position-sort" :value="sort" @change="setSort">
          <option value="published">最近发布</option>
          <option value="id">按职位编号</option>
        </select>
      </div>
      <button
        class="v4-clear-button"
        type="button"
        title="清除筛选"
        aria-label="清除筛选"
        @click="clearFilters"
      >
        <span aria-hidden="true">↻</span>
      </button>
      <div class="v4-view-switch" role="group" aria-label="列表视图">
        <button type="button" :aria-pressed="!tableView" @click="setView(false)">
          {{ positions ? '▦ 卡片' : '▥ 看板' }}
        </button>
        <button type="button" :aria-pressed="tableView" @click="setView(true)">☷ 表格</button>
      </div>
    </form>
    <p v-if="!positions && !isDetail && historyPositionIssue" class="v4-list-note" role="status">
      职位列表暂不可用，可输入职位 ID 查询。
      <button class="v4-text-button" type="button" @click="loadHistoryPositions">
        重新读取职位
      </button>
    </p>
    <V3RecruitingEditor
      v-if="editor"
      :key="editor.key"
      :positions="positions"
      :row="editor.row"
      :action="editor.action"
      :options="options"
      @vue:mounted="editorFocus.enter"
      @close="cancelWithFocus"
      @saved="saved"
    />
    <V3Feedback v-if="isDetail && loading && !application" state="loading" title="读取详情中" />
    <V3Feedback
      v-else-if="isDetail && error"
      state="error"
      :title="
        detailIssueStatus === 404
          ? '未找到申请'
          : detailIssueStatus === 403
            ? '没有权限查看申请'
            : '暂时无法查看记录'
      "
      :message="error"
      action="重新加载"
      @action="load"
    />
    <V3Feedback
      v-if="!isDetail && loading"
      class="v4-list-loading"
      state="loading"
      title="加载记录中"
    />
    <V3Feedback
      v-if="!isDetail && error"
      state="error"
      title="暂时无法查看记录"
      :message="error"
      action="重新加载"
      @action="load"
    />
    <button
      v-if="positions && error && sort === 'published'"
      class="v4-text-button"
      type="button"
      @click="changeSort('id')"
    >
      改用职位编号顺序
    </button>
    <div
      v-if="!isDetail && !positions && !tableView"
      class="v4-board"
      :class="{ 'v4-board-focus': !!effectiveQuery.stage }"
    >
      <V4ApplicationColumn
        v-for="column in visibleStages"
        :key="column"
        :stage="column"
        :query="effectiveQuery"
        :query-key="route.fullPath + ':' + boardRevision"
        :enabled="sessionReady"
        :focus="!!effectiveQuery.stage"
        :filtered="filtered"
        :restore="restoreColumns?.[column]"
        @open="rememberApplication"
        @restored="restoreApplicationFocus"
      />
    </div>
    <template v-if="!isDetail && (positions || tableView) && !loading && !error">
      <V3Feedback
        v-if="!items.length"
        state="empty"
        :title="filtered ? '没有匹配的记录' : '暂时没有记录'"
        :message="
          filtered
            ? '请调整搜索或筛选条件。'
            : positions
              ? '新建职位后即可接收申请。'
              : '添加申请，开始跟进招聘进展。'
        "
        :action="filtered ? '清除筛选' : undefined"
        @action="clearFilters"
      />
      <div v-else-if="positions && !tableView" class="v4-position-grid">
        <article v-for="row in positionItems" :key="row.id" class="v4-position-card">
          <header>
            <h2 :title="row.title">{{ row.title }}</h2>
            <V4PositionMenu
              :row="row"
              :disabled="!!gate.current.value"
              @action="(event, action, opener) => openEditor(event, row, action, opener)"
            />
          </header>
          <p class="v4-position-meta">{{ row.department || '—' }} · {{ row.location || '—' }}</p>
          <div class="v4-position-identity">
            <V4JobGlyph /><small>职位 #{{ row.id }}</small>
            <span class="v4-record-badge" :data-state="row.status">{{
              row.status === 'open' ? '招聘中' : '已关闭'
            }}</span>
            <span v-if="row.deletedAt !== null" class="v4-record-badge">已归档</span>
          </div>
          <div class="v4-position-stats">
            <div>
              <strong>{{ row.applicationRecords }}</strong
              ><small>累计申请记录</small>
            </div>
            <div>
              <strong>{{ row.activeApplications }}</strong
              ><small>活跃申请记录</small>
            </div>
            <div class="v4-position-interviews">
              <strong>{{
                interviewCounts[row.id] === undefined
                  ? '读取中…'
                  : interviewCounts[row.id] === null
                    ? '不可用'
                    : interviewCounts[row.id] + ' 场'
              }}</strong>
              <small>已完成面试</small>
            </div>
          </div>
          <footer>
            <span>发布日期 {{ row.publishDate || '—' }}</span>
            <RouterLink
              class="v4-text-button"
              :to="positionLink(row.id, route.fullPath)"
              :data-position-link="row.id"
              @click="rememberPosition($event, route.fullPath, row.id)"
              >查看详情 <span aria-hidden="true">›</span></RouterLink
            >
          </footer>
        </article>
      </div>
      <section
        v-else
        class="v3-card v4-recruiting-table"
        :class="{ 'v4-positions-table': positions }"
      >
        <V3TableScroll name="职位与申请记录表格" vertical>
          <table aria-label="职位与申请记录">
            <thead>
              <tr>
                <th
                  v-for="column in positions ? positionColumns : applicationColumns"
                  :key="column"
                  scope="col"
                >
                  {{ column }}
                </th>
              </tr>
            </thead>
            <tbody v-if="positions">
              <tr v-for="row in positionItems" :key="row.id">
                <td>
                  <strong>{{ row.title }}</strong
                  ><small>{{ row.department || '—' }} · #{{ row.id }}</small>
                </td>
                <td>
                  <span class="v4-record-badge" :data-state="row.status">{{
                    row.status === 'open' ? '招聘中' : '已关闭'
                  }}</span>
                  <span v-if="row.deletedAt" class="v4-record-badge">已归档</span>
                </td>
                <td>{{ row.applicationRecords }} 条</td>
                <td>{{ row.publishDate || '—' }}</td>
                <td>
                  <div class="v4-row-actions">
                    <RouterLink
                      class="v4-text-button"
                      :to="positionLink(row.id, route.fullPath)"
                      :data-position-link="row.id"
                      @click="rememberPosition($event, route.fullPath, row.id)"
                      >查看详情</RouterLink
                    >
                    <V4PositionMenu
                      :row="row"
                      :disabled="!!gate.current.value"
                      @action="(event, action, opener) => openEditor(event, row, action, opener)"
                    />
                  </div>
                </td>
              </tr>
            </tbody>
            <tbody v-else>
              <tr v-for="row in applicationItems" :key="row.id">
                <td>
                  <strong>{{ row.name }}</strong
                  ><small>#{{ row.id }}</small>
                </td>
                <td>
                  {{ row.positionTitle }}<small>#{{ row.positionId }}</small>
                </td>
                <td>{{ row.owner || '—' }}</td>
                <td>
                  <span class="v4-record-badge" data-state="stage">{{ label(row.stage) }}</span>
                </td>
                <td>
                  <span class="v4-record-badge" :data-state="row.applicationStatus">{{
                    label(row.applicationStatus)
                  }}</span>
                </td>
                <td>
                  {{ applicationOutcomeText(row) }}<small>{{ applicationOfferText(row) }}</small>
                </td>
                <td>{{ row.appliedDate || '—' }}</td>
                <td>
                  <div class="v4-row-actions">
                    <button
                      class="v4-text-button"
                      type="button"
                      :data-application-link="row.id"
                      @click="showDetail(row, $event)"
                    >
                      查看详情
                    </button>
                    <el-button
                      text
                      :disabled="!!gate.current.value || row.applicationStatus === 'closed'"
                      @click="openEditor($event, row)"
                      >编辑</el-button
                    >
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </V3TableScroll>
      </section>
      <footer v-if="items.length" class="v4-list-footer" aria-label="分页">
        <p>
          共 {{ total }} 条 · 显示 {{ offset + 1 }}–{{ Math.min(offset + pageSize, total) }} 条 ·
          每页 {{ pageSize }} 条
        </p>
        <nav aria-label="列表页码">
          <el-button :disabled="offset === 0" @click="page(-pageSize)">上一页</el-button>
          <button
            v-for="number in pageNumbers"
            :key="number"
            type="button"
            :aria-current="number === currentPage ? 'page' : undefined"
            @click="goToOffset((number - 1) * pageSize)"
          >
            {{ number }}
          </button>
          <el-button :disabled="offset + pageSize >= total" @click="page(pageSize)"
            >下一页</el-button
          >
        </nav>
      </footer>
    </template>
    <div v-if="isDetail && application" class="v4-detail-layout">
      <aside
        ref="detailProfile"
        class="v3-card v3-detail-aside"
        :class="{ 'v4-profile-too-tall': profileTooTall }"
        aria-label="申请资料"
      >
        <h2>候选人档案</h2>
        <div class="v4-profile-summary" :data-state="application.applicationStatus">
          <span class="v4-profile-avatar" aria-hidden="true">{{
            Array.from(application.name.replace(/^\[虚构演示\]\s*/, '').trim() || '申')[0]
          }}</span>
          <div>
            <strong>{{ application.name || '姓名未记录' }}</strong>
            <small>申请 #{{ application.id }}</small>
          </div>
          <span class="v3-state-label" :data-state="application.applicationStatus">{{
            label(application.applicationStatus)
          }}</span>
        </div>
        <div class="v4-profile-job">
          <V4JobGlyph />
          <div>
            <strong>{{ application.positionTitle || '职位名称未记录' }}</strong
            ><small>职位 #{{ application.positionId }}</small>
          </div>
        </div>
        <dl class="v4-profile-primary">
          <div>
            <dt>业务负责人</dt>
            <dd>{{ profileText('owner') }}</dd>
          </div>
          <div>
            <dt>申请日期</dt>
            <dd>{{ profileText('appliedDate') }}</dd>
          </div>
        </dl>
        <h3 class="v4-profile-section-title">基础资料</h3>
        <dl class="v4-profile-fields v4-profile-contact">
          <div v-for="[key, text] in basicProfileFields" :key="key">
            <dt>{{ text }}</dt>
            <dd>{{ profileText(key) }}</dd>
          </div>
          <div>
            <dt>学历 / 学校</dt>
            <dd>{{ profileText('education') }} · {{ profileText('school') }}</dd>
          </div>
        </dl>
        <div v-if="application.skills" class="v4-profile-skills">
          <h3>技能摘要</h3>
          <p>{{ application.skills }}</p>
        </div>
        <button
          ref="profileToggle"
          type="button"
          class="v3-profile-toggle"
          :aria-expanded="profileExpanded"
          aria-controls="v3-extra-profile"
          @click="toggleProfile"
        >
          {{ profileExpanded ? '收起更多资料' : '展开更多资料' }}
        </button>
        <div
          v-show="profileExpanded"
          id="v3-extra-profile"
          @keydown.esc.stop.prevent="collapseProfile"
        >
          <dl class="v4-profile-fields">
            <div v-for="[key, text] in extraProfileFields" :key="key">
              <dt>{{ text }}</dt>
              <dd tabindex="0">{{ profileText(key) }}</dd>
            </div>
          </dl>
        </div>
      </aside>

      <div class="v4-detail-workspace">
        <section ref="detailProgress" class="v3-card v4-progress" aria-label="招聘进度">
          <header>
            <h2>招聘进度</h2>
            <small>仅表示阶段位置</small>
          </header>
          <ol class="v3-detail-stages" aria-label="招聘阶段位置，不代表事件历史">
            <li
              v-for="(item, index) in stages"
              :key="item"
              :aria-current="application.stage === item ? 'step' : undefined"
            >
              <span class="v4-stage-number" aria-hidden="true">{{ index + 1 }}</span>
              <div>
                <strong>{{ label(item) }}</strong
                ><small>{{ progressText(index) }}</small>
              </div>
            </li>
          </ol>
        </section>
        <div
          ref="detailTabBar"
          class="v3-card v4-detail-tabbar"
          role="tablist"
          aria-label="申请详情业务标签"
          @keydown="moveTabFocus"
        >
          <div class="v4-detail-tabs">
            <button
              v-for="entry in detailSections"
              :id="'v4-detail-tab-' + entry.key"
              :key="entry.key"
              type="button"
              role="tab"
              :data-detail-tab="entry.key"
              :tabindex="focusedTab === entry.key ? 0 : -1"
              :aria-selected="activeTab === entry.key"
              :aria-controls="'v4-detail-panel-' + entry.key"
              @focus="focusedTab = entry.key"
              @click="selectTab(entry.key)"
            >
              {{ entry.text }}
            </button>
          </div>
        </div>
        <div v-if="editorTab && editorTab !== activeTab" class="v4-detail-notice" role="status">
          {{ v3UncertainWrite ? '原操作结果待确认。' : '有一笔编辑保留在原标签。' }}
          <button class="v4-text-button" type="button" @click="locate(editorTab)">
            回到原操作
          </button>
        </div>
        <div v-if="loading || error || refreshPending" class="v4-detail-notice" role="status">
          {{
            refreshPending ? '当前编辑或请求结束后将刷新。' : '正在核实最新资料，业务操作暂不可用。'
          }}
        </div>
        <p v-if="navigationMessage" role="status" class="v3-detail-navigation-message">
          {{ navigationMessage }}
        </p>
        <p v-if="detailNotice" role="status" class="v4-detail-notice">{{ detailNotice }}</p>

        <div class="v4-detail-pane" aria-label="申请详情正文">
          <section
            v-show="activeTab === 'task'"
            id="v4-detail-panel-task"
            role="tabpanel"
            aria-labelledby="v4-detail-tab-task"
            tabindex="0"
            class="v4-detail-tabpanel"
          >
            <section class="v3-card v3-detail-task">
              <header class="v4-panel-heading">
                <h2>任务概览</h2>
                <span class="v3-state-label" :data-state="application.applicationStatus"
                  >{{ label(application.stage) }} · {{ label(application.applicationStatus) }}</span
                >
              </header>
              <div class="v4-task-lead">
                <span class="v4-detail-symbol" aria-hidden="true"
                  ><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
                    <path d="m4 16-1 5 5-1L20 8l-4-4ZM13 7l4 4" /></svg
                ></span>
                <div>
                  <h3>{{ task?.title }}</h3>
                  <p>{{ task?.detail }}</p>
                  <p v-if="application.applicationStatus === 'closed'">
                    结束原因：{{ application.closedReason || '未记录' }}
                  </p>
                </div>
              </div>
              <div
                v-if="verifiedDecision && application.applicationStatus === 'active'"
                class="v4-task-counts"
              >
                <div>
                  <small>当前轮已完成面试</small
                  ><strong>{{ verifiedDecision.completedCount }} 场</strong>
                </div>
                <div>
                  <small>当前轮有效面评</small
                  ><strong
                    >{{
                      verifiedDecision.completed.filter((row) => row.feedbackId !== null).length
                    }}
                    份</strong
                  >
                </div>
                <div>
                  <small>待处理预约</small
                  ><strong>{{ verifiedDecision.scheduled.length }} 场</strong>
                </div>
              </div>
            </section>
            <section class="v3-card">
              <h2>业务操作</h2>
              <div class="v4-task-actions">
                <article>
                  <h3>{{ task?.title }}</h3>
                  <el-button type="primary" @click="goToTask">{{ task?.action }}</el-button>
                </article>
                <article>
                  <h3>
                    {{ application.applicationStatus === 'closed' ? '已有面评' : '核对决定依据' }}
                  </h3>
                  <el-button
                    @click="
                      locate(
                        application.applicationStatus === 'closed'
                          ? 'feedback'
                          : task?.target === 'decision'
                            ? 'interviews'
                            : 'decision'
                      )
                    "
                    >{{
                      application.applicationStatus === 'closed'
                        ? '查看已有评价'
                        : task?.target === 'decision'
                          ? '查看面试与面评'
                          : '查看 HR 决策'
                    }}</el-button
                  >
                </article>
              </div>
            </section>
          </section>
          <section
            v-show="activeTab === 'interviews'"
            id="v4-detail-panel-interviews"
            role="tabpanel"
            aria-labelledby="v4-detail-tab-interviews"
            tabindex="0"
            class="v4-detail-tabpanel"
          >
            <V3Interviews
              :key="application.id"
              :refresh-token="detailRevision"
              :application-id="application.id"
              data-detail-target="Interviews"
              :disabled="detailBlocked || !!editor"
              @updated="detailUpdated"
            >
              <template
                #embedded-records="{ items: interviewRows, openEditor: openMeeting, canChange }"
              >
                <V3FeedbackPanel
                  :key="'feedback-' + application.id"
                  :disabled="detailBlocked"
                  :refresh-token="detailRevision"
                  :application-id="application.id"
                  data-detail-target="FeedbackPanel"
                  @updated="detailUpdated"
                >
                  <template #meeting-actions="{ meeting }">
                    <div v-if="meeting.status === 'scheduled'" class="v4-meeting-actions">
                      <el-button
                        v-for="action in meetingActions"
                        :key="action"
                        :disabled="!canChange(meeting)"
                        @click="openMeeting($event, meeting, action)"
                        >{{ interviewAction[action] }}</el-button
                      >
                    </div>
                  </template>
                  <template #unavailable>
                    <article
                      v-for="meeting in interviewRows"
                      :key="meeting.id"
                      class="v3-card"
                      :data-interview-id="meeting.id"
                    >
                      <h3>{{ label(meeting.stageScope) }} · 面试 #{{ meeting.id }}</h3>
                      <p>
                        {{ meeting.scheduledLocal }} · {{ meeting.interviewerName }} ·
                        {{ interviewStatus[meeting.status] }}
                      </p>
                      <div v-if="meeting.status === 'scheduled'" class="v4-meeting-actions">
                        <el-button
                          v-for="action in meetingActions"
                          :key="action"
                          :disabled="!canChange(meeting)"
                          @click="openMeeting($event, meeting, action)"
                          >{{ interviewAction[action] }}</el-button
                        >
                      </div>
                    </article>
                  </template>
                </V3FeedbackPanel>
              </template>
            </V3Interviews>
          </section>
          <section
            v-show="activeTab === 'decision'"
            id="v4-detail-panel-decision"
            role="tabpanel"
            aria-labelledby="v4-detail-tab-decision"
            tabindex="0"
            class="v4-detail-tabpanel"
          >
            <V3AdvancementPanel
              :key="'advance-' + application.id"
              :disabled="detailBlocked"
              :refresh-token="detailRevision"
              :application-id="application.id"
              data-detail-target="AdvancementPanel"
              @updated="detailUpdated"
              @facts="decision = $event"
            />
          </section>
          <section
            v-show="activeTab === 'offer'"
            id="v4-detail-panel-offer"
            role="tabpanel"
            aria-labelledby="v4-detail-tab-offer"
            tabindex="0"
            class="v4-detail-tabpanel"
          >
            <V3OfferPanel
              :key="'offer-' + application.id"
              :disabled="detailBlocked"
              :refresh-token="detailRevision"
              :application-id="application.id"
              data-detail-target="OfferPanel"
              @updated="detailUpdated"
              @facts="offer = $event"
            />
          </section>
          <section
            v-show="activeTab === 'history'"
            id="v4-detail-panel-history"
            role="tabpanel"
            aria-labelledby="v4-detail-tab-history"
            tabindex="0"
            class="v4-detail-tabpanel"
          >
            <V4ApplicationHistory
              :application-id="application.id"
              :active="activeTab === 'history'"
              :revision="detailRevision"
              @source="locate"
            />
          </section>
        </div>
      </div>
    </div>
  </section>
</template>
<script lang="ts">
let applicationReturn:
  | {
      path: string
      owner: number
      id: number
      stage?: string
      columns: Record<string, { count: number; top: number }>
      tableTop: number
      tableLeft: number
    }
  | undefined
</script>
<script setup lang="ts">
import { useEditorFocus } from '../utils/v3-editor-focus'
import { applicationOutcomeText, applicationOfferText } from '../api/recruiting-v3'
import V3TableScroll from '../components/V3TableScroll.vue'
import { computed, nextTick, onUnmounted, provide, ref, watch } from 'vue'
import { useRoute, useRouter, type LocationQuery } from 'vue-router'
import { adaptV3Error, readV3, v3Session } from '../api/request-v3'
import { latestRead } from '../api/v3-operation'
import {
  label,
  detail,
  applicationFields,
  type Application,
  type Position,
  type RecruitingRow,
  type Page
} from '../api/recruiting-v3'
import V3FilterSelect from '../components/V3FilterSelect.vue'
import V3Feedback from '../components/V3Feedback.vue'
import V3RecruitingEditor from '../components/V3RecruitingEditor.vue'
import V3Interviews from './V3Interviews.vue'
import V3OfferPanel from '../components/V3OfferPanel.vue'
import V3AdvancementPanel from '../components/V3AdvancementPanel.vue'
import V3FeedbackPanel from '../components/V3FeedbackPanel.vue'
import { createEditorGate, editorGateKey } from '../utils/v3-editor-gate'
import V4JobGlyph from '../components/V4JobGlyph.vue'
import V4PositionMenu from '../components/V4PositionMenu.vue'
import V4ApplicationColumn from '../components/V4ApplicationColumn.vue'
import {
  availableOffset,
  byPublishDate,
  collectPositions,
  listParams,
  recruitingStages,
  validOffset
} from '../api/v4-recruiting-lists'
import { currentTask } from '../api/v4-application-detail'
import type { Preflight } from '../api/advancement-v3'
import type { OfferContext } from '../api/offer-v3'
import { interviewAction, interviewStatus } from '../api/interview-v3'
import { v3UncertainWrite } from '../router/v3-drafts'
import V4ApplicationHistory from '../components/V4ApplicationHistory.vue'
import '../styles/v3-recruiting.scss'
import '../styles/v4-application-detail.scss'
import { positionLink, rememberPosition, restorePosition } from '../router/v4-position-navigation'
import { safeReturn } from '../router/v3-navigation'
import '../styles/v4-recruiting-lists.scss'
const gate = createEditorGate()
provide(editorGateKey, gate)
let profileLease: symbol | null = null
let alive = true
const route = useRoute(),
  router = useRouter()
const positions = computed(() => route.path === '/positions')
const isDetail = computed(() => route.name === 'candidate-detail')
const resource = computed(() => (positions.value ? 'positions' : 'applications'))
const search = ref(''),
  status = ref(''),
  stage = ref(''),
  positionFilter = ref('')
const items = ref<RecruitingRow[]>([]),
  total = ref(0),
  loading = ref(false),
  error = ref('')
const refreshPending = ref(false),
  detailRevision = ref(0)
const selected = ref<RecruitingRow | null>(null),
  options = ref<Position[]>([])
const editor = ref<{
  row: RecruitingRow | null
  action: 'edit' | 'status' | 'archive'
  key: number
} | null>(null)
let editorKey = 0
let openingGeneration = 0
const query = latestRead()
const positionMetricsRead = latestRead()
const positionHistoryRead = latestRead()
const tableView = computed(() => route.query.view === 'table')
const sort = computed(() => (route.query.sort === 'id' ? 'id' : 'published'))
const pageSize = computed(() => (positions.value ? (tableView.value ? 10 : 9) : 20))
const offset = computed(() => validOffset(route.query.offset, pageSize.value))
const currentPage = computed(() => offset.value / pageSize.value + 1)
const pageNumbers = computed(() => {
  const count = Math.ceil(total.value / pageSize.value)
  const start = Math.max(1, Math.min(currentPage.value - 2, count - 4))
  return Array.from({ length: Math.min(count, 5) }, (_, index) => start + index)
})
const sessionReady = computed(() => v3Session.state.status === 'ready')
const effectiveQuery = computed<LocationQuery>(() => {
  if (positions.value) return route.query
  const query: LocationQuery = {
    ...route.query,
    applicationStatus: route.query.applicationStatus || 'active'
  }
  if (!stages.some((entry) => entry === query.stage)) delete query.stage
  return query
})
const filtered = computed(() =>
  Boolean(
    route.query.q ||
      route.query.status ||
      route.query.stage ||
      route.query.positionId ||
      (route.query.applicationStatus && route.query.applicationStatus !== 'active')
  )
)
const positionColumns = ['职位名称', '状态', '申请记录数', '发布日期', '操作']
const applicationColumns = [
  '候选人 / 申请 ID',
  '关联职位 / 职位 ID',
  '业务负责人',
  '当前阶段',
  '申请状态',
  '招聘结果 · Offer',
  '申请日期',
  '操作'
]
const stages = recruitingStages
const stageOptions = Object.fromEntries(stages.map((stage) => [stage, label(stage)]))
const visibleStages = computed(() =>
  stages.filter((entry) => !effectiveQuery.value.stage || entry === effectiveQuery.value.stage)
)
const positionItems = computed(() => items.value as Position[])
const applicationItems = computed(() => items.value as Application[])
const positionCounts = ref<Partial<Record<'open' | 'closed', number>>>({})
const interviewCounts = ref<Record<number, number | null>>({})
const historyPositions = ref<Position[]>([])
const historyPositionIssue = ref(false)
const historyPositionOptions = computed(() => {
  const entries: Record<string, string> = {}
  for (const row of historyPositions.value) {
    const suffix = row.deletedAt ? ' · 已归档' : row.status === 'closed' ? ' · 已关闭' : ''
    entries[String(row.id)] = row.title + ' · #' + row.id + suffix
  }
  const selectedId = typeof route.query.positionId === 'string' ? route.query.positionId : ''
  if (selectedId && !entries[selectedId]) entries[selectedId] = '职位 #' + selectedId
  return entries
})
const boardRevision = ref(0)
const restoreColumns = computed(() =>
  applicationReturn?.path === route.fullPath && applicationReturn.owner === v3Session.version()
    ? applicationReturn.columns
    : undefined
)

function loadPositionCounts() {
  return positionMetricsRead.execute(
    () =>
      Promise.allSettled(
        ['open', 'closed'].map((status) =>
          readV3<Page<Position>>('/positions?' + listParams({ status }, true, 1, 0))
        )
      ),
    ([open, closed]) => {
      positionCounts.value = {
        open: open.status === 'fulfilled' ? open.value.total : undefined,
        closed: closed.status === 'fulfilled' ? closed.value.total : undefined
      }
    },
    () => {
      positionCounts.value = {}
    }
  )
}

function loadHistoryPositions() {
  const owner = v3Session.version()
  return positionHistoryRead.execute(
    () =>
      collectPositions(
        (start, limit) =>
          readV3<Page<Position>>('/positions?' + listParams({}, true, limit, start)),
        () =>
          alive &&
          !positions.value &&
          !isDetail.value &&
          sessionReady.value &&
          owner === v3Session.version()
      ),
    (rows) => {
      historyPositions.value = rows
      historyPositionIssue.value = false
    },
    () => {
      historyPositions.value = []
      historyPositionIssue.value = true
    }
  )
}

function loadInterviewCounts(rows: Position[], current: () => boolean) {
  interviewCounts.value = {}
  void Promise.all(
    rows.map(async (row) => {
      let count: number | null = null
      try {
        const result = await readV3<{ total: number }>(
          '/interviews?' +
            new URLSearchParams({
              positionId: String(row.id),
              status: 'completed',
              limit: '1',
              offset: '0'
            })
        )
        if (Number.isSafeInteger(result.total) && result.total >= 0) count = result.total
      } catch {
        // Auxiliary counts can fail independently of position rows.
      }
      if (current()) interviewCounts.value[row.id] = count
    })
  )
}

let loadRound = 0
function load() {
  if (!alive || !sessionReady.value) return
  if (isDetail.value && gate.current.value) {
    refreshPending.value = true
    return
  }
  refreshPending.value = false
  detailIssueStatus.value = 0
  error.value = ''
  if (!isDetail.value && !positions.value && !tableView.value) {
    loading.value = false
    boardRevision.value++
    return
  }
  const path = route.fullPath
  const owner = v3Session.version()
  const round = ++loadRound
  const current = () =>
    alive &&
    sessionReady.value &&
    path === route.fullPath &&
    owner === v3Session.version() &&
    round === loadRound
  const start = offset.value
  const size = pageSize.value
  const filters = effectiveQuery.value
  const published = positions.value && sort.value === 'published'
  loading.value = true
  return query.execute<RecruitingRow | Page<RecruitingRow>>(
    async () => {
      if (isDetail.value) return detail('applications', Number(route.params.id))
      if (published) {
        const rows = byPublishDate(
          await collectPositions(
            (index, limit) =>
              readV3<Page<Position>>('/positions?' + listParams(filters, true, limit, index)),
            current
          )
        )
        return {
          items: rows.slice(start, start + size),
          total: rows.length,
          limit: size,
          offset: start
        }
      }
      return readV3<Page<RecruitingRow>>(
        '/' + resource.value + '?' + listParams(filters, positions.value, size, start)
      )
    },
    (data) => {
      if (!current()) return
      loading.value = false
      if ('items' in data) {
        const legalOffset = availableOffset(data.total, start, size)
        if (legalOffset !== start) {
          items.value = []
          loading.value = true
          void goToOffset(legalOffset, true)
          return
        }
        items.value = data.items
        total.value = data.total
        if (positions.value && !tableView.value)
          loadInterviewCounts(data.items as Position[], current)
        if (!positions.value) void restoreApplicationFocus()
        else void restorePosition(route.fullPath)
      } else {
        selected.value = data
        detailRevision.value++
        if (detailNotice.value) detailNotice.value = '服务器状态已更新。'
      }
    },
    (failure) => {
      if (!current()) return
      loading.value = false
      detailIssueStatus.value = adaptV3Error(failure).status
      error.value = failure instanceof Error ? failure.message : '读取失败'
    }
  )
}
const detailRoot = ref<HTMLElement | null>(null)
const detailProfile = ref<HTMLElement | null>(null)
const detailProgress = ref<HTMLElement | null>(null)
const detailTabBar = ref<HTMLElement | null>(null)
const profileTooTall = ref(false)
watch(detailProfile, (profile, _, onCleanup) => {
  const scroll = profile?.closest<HTMLElement>('.v3-content')
  if (!profile || !scroll) return
  const update = () => {
    const inset = Number.parseFloat(getComputedStyle(profile).top) || 0
    const padding = Number.parseFloat(getComputedStyle(scroll).paddingTop) || 0
    profileTooTall.value = profile.offsetHeight + padding + 2 * inset > scroll.clientHeight
  }
  const observer = new ResizeObserver(update)
  observer.observe(profile)
  observer.observe(scroll)
  update()
  onCleanup(() => observer.disconnect())
})
const profileToggle = ref<HTMLButtonElement | null>(null)
const profileExpanded = ref(false)
const navigationMessage = ref('')
const detailNotice = ref('')
const detailIssueStatus = ref(0)
const detailSections = [
  { key: 'task', text: '当前任务' },
  { key: 'interviews', text: '面试与面评' },
  { key: 'decision', text: 'HR 决策' },
  { key: 'offer', text: 'Offer 与结案' },
  { key: 'history', text: '真实历史' }
] as const
type DetailTab = (typeof detailSections)[number]['key']
const activeTab = ref<DetailTab>('task')
const focusedTab = ref<DetailTab>('task')
const editorTab = ref<DetailTab | null>(null)
const decision = ref<Preflight | null>(null)
const offer = ref<OfferContext | null>(null)
const application = computed(() => (isDetail.value ? (selected.value as Application | null) : null))
const detailBlocked = computed(() => loading.value || !!error.value || refreshPending.value)
const verifiedDecision = computed(() =>
  !detailBlocked.value &&
  decision.value?.version === application.value?.version &&
  decision.value?.fromStage === application.value?.stage
    ? decision.value
    : null
)
const task = computed(() =>
  application.value
    ? currentTask(
        application.value,
        verifiedDecision.value,
        detailBlocked.value ? null : offer.value
      )
    : null
)
const meetingActions = ['reschedule', 'complete', 'cancel'] as const
const basicProfileFields = applicationFields.filter(([key]) => ['phone', 'email'].includes(key))
const extraProfileFields = applicationFields.filter(([key]) => ['experience', 'note'].includes(key))
const detailTargets: Record<string, { tab: DetailTab; selector: string }> = {
  feedback: { tab: 'interviews', selector: '[data-detail-target="FeedbackPanel"]' },
  'advancement-history': { tab: 'decision', selector: '[data-detail-history="advancement"]' },
  'offer-history': { tab: 'offer', selector: '[data-detail-history="offer"]' }
}

function progressText(index: number) {
  const stage = stages.findIndex((item) => item === application.value?.stage)
  if (stage < 0) return '待核实'
  return index === stage ? '当前位置' : index < stage ? '已越过' : '尚未到达'
}

async function selectTab(key: DetailTab) {
  if (key === activeTab.value) return
  const bar = detailTabBar.value
  const progress = detailProgress.value
  const scroll = bar?.closest<HTMLElement>('.v3-content')
  let nextTop = scroll?.scrollTop ?? 0
  if (bar && progress && scroll) {
    const inset = Number.parseFloat(getComputedStyle(bar).top) || 0
    const gap = Number.parseFloat(getComputedStyle(bar.parentElement ?? bar).rowGap) || 0
    const padding = Number.parseFloat(getComputedStyle(scroll).paddingTop) || 0
    const tabStart =
      nextTop +
      progress.getBoundingClientRect().bottom +
      gap -
      scroll.getBoundingClientRect().top -
      scroll.clientTop -
      padding -
      inset
    nextTop = Math.min(nextTop, Math.max(0, tabStart))
  }
  navigationMessage.value = ''
  focusedTab.value = activeTab.value = key
  await nextTick()
  if (activeTab.value === key && scroll) scroll.scrollTop = nextTop
}

function moveTabFocus(event: KeyboardEvent) {
  const index = detailSections.findIndex((entry) => entry.key === focusedTab.value)
  const count = detailSections.length
  const targets: Record<string, number> = {
    ArrowRight: (index + 1) % count,
    ArrowLeft: (index + count - 1) % count,
    Home: 0,
    End: count - 1
  }
  const target = targets[event.key]
  if (typeof target !== 'number') return
  event.preventDefault()
  const key = detailSections[target].key
  focusedTab.value = key
  detailTabBar.value?.querySelector<HTMLButtonElement>('[data-detail-tab="' + key + '"]')?.focus()
}

function focusSection(section: Element | null) {
  const heading = section?.querySelector<HTMLElement>('h1, h2, h3')
  if (!section || !heading) {
    navigationMessage.value = '该区域暂不可用，请等待读取完成或重试。'
    return false
  }
  heading.setAttribute('tabindex', '-1')
  heading.focus({ preventScroll: true })
  heading.scrollIntoView({ block: 'nearest' })
  return true
}
async function locate(key: string) {
  const source = detailTargets[key]
  const tab = source?.tab ?? detailSections.find((entry) => entry.key === key)?.key
  if (!tab) return
  await selectTab(tab)
  if (activeTab.value !== tab) return
  const selector = source?.selector ?? '#v4-detail-panel-' + tab
  focusSection(detailRoot.value?.querySelector(selector) ?? null)
}
function goToTask() {
  if (task.value) void locate(task.value.target)
}
function detailUpdated() {
  detailNotice.value = '操作已保存，正在重新核实服务器状态。'
  void load()
}
function profileText(key: string) {
  const value = selected.value && (selected.value as unknown as Record<string, unknown>)[key]
  return value === null || value === undefined || String(value).trim() === ''
    ? ['phone', 'email'].includes(key)
      ? '未提供'
      : '未记录'
    : String(value)
}
async function collapseProfile() {
  profileExpanded.value = false
  await nextTick()
  profileToggle.value?.focus({ preventScroll: true })
}
async function toggleProfile() {
  if (profileExpanded.value) await collapseProfile()
  else profileExpanded.value = true
}
watch(
  () => gate.current.value,
  (lease) => {
    if (!isDetail.value) return
    editorTab.value = lease ? activeTab.value : null
  },
  { flush: 'sync' }
)

function filter() {
  return router.push({
    path: route.path,
    query: {
      ...(tableView.value ? { view: 'table' } : !positions.value ? { view: 'board' } : {}),
      ...(positions.value && sort.value === 'id' ? { sort: 'id' } : {}),
      ...(search.value.trim() ? { q: search.value.trim() } : {}),
      ...(status.value ? { [positions.value ? 'status' : 'applicationStatus']: status.value } : {}),
      ...(!positions.value && stage.value ? { stage: stage.value } : {}),
      ...(!positions.value && positionFilter.value ? { positionId: positionFilter.value } : {})
    }
  })
}
function applyStatus(value: string) {
  status.value = value
  void filter()
}
function applyPosition(value: string) {
  positionFilter.value = value
  void filter()
}
function applyStage(value: string) {
  stage.value = value
  void filter()
}
function clearFilters() {
  search.value = stage.value = positionFilter.value = ''
  status.value = positions.value ? '' : 'active'
  return filter()
}
function setView(table: boolean) {
  if (table === tableView.value) return
  const newSize = positions.value ? (table ? 10 : 9) : 20
  return router.push({
    path: route.path,
    query: {
      ...route.query,
      view: table ? 'table' : positions.value ? undefined : 'board',
      offset: positions.value ? String(Math.floor(offset.value / newSize) * newSize) : undefined
    }
  })
}
function setSort(event: Event) {
  void changeSort((event.target as HTMLSelectElement).value)
}
function changeSort(value: string) {
  return router.push({
    path: route.path,
    query: { ...route.query, sort: value === 'id' ? value : undefined, offset: undefined }
  })
}
function goToOffset(start: number, replace = false) {
  const to = {
    path: route.path,
    query: { ...route.query, offset: start ? String(start) : undefined }
  }
  return replace ? router.replace(to) : router.push(to)
}
function page(amount: number) {
  return goToOffset(offset.value + amount)
}

function rememberApplication(event: MouseEvent, id: number) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
  const columns: Record<string, { count: number; top: number }> = {}
  for (const viewport of detailRoot.value?.querySelectorAll<HTMLElement>('.v4-stage-scroll') ??
    []) {
    const stage = viewport.closest<HTMLElement>('[data-stage]')?.dataset.stage
    if (stage) columns[stage] = { top: viewport.scrollTop, count: Number(viewport.dataset.loaded) }
  }
  const table = detailRoot.value?.querySelector('.v3-table-scroll')
  const source = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined
  applicationReturn = {
    path: route.fullPath,
    owner: v3Session.version(),
    id,
    stage: source?.closest<HTMLElement>('[data-stage]')?.dataset.stage,
    columns,
    tableTop: table?.scrollTop ?? 0,
    tableLeft: table?.scrollLeft ?? 0
  }
}

function backToApplications() {
  const source = safeReturn(route.query.fromPosition)
  if (source.startsWith('/positions/')) return router.push(source)
  const legal =
    applicationReturn?.owner === v3Session.version() &&
    applicationReturn.id === Number(route.params.id)
  return router.push(legal && applicationReturn ? applicationReturn.path : '/candidates')
}

async function restoreApplicationFocus(restoredStage?: string) {
  const context = applicationReturn
  if (!context || context.path !== route.fullPath || context.owner !== v3Session.version()) return
  await nextTick()
  if (context !== applicationReturn || context.path !== route.fullPath) return
  const opener = detailRoot.value?.querySelector<HTMLElement>(
    '[data-application-link="' + context.id + '"]'
  )
  if (!opener && !tableView.value && restoredStage !== context.stage) return
  const table = detailRoot.value?.querySelector('.v3-table-scroll')
  table?.scrollTo(context.tableLeft, context.tableTop)
  if (opener) opener.focus({ preventScroll: true })
  else detailRoot.value?.querySelector<HTMLElement>('h1')?.focus()
  applicationReturn = undefined
}
async function openEditor(
  event: MouseEvent,
  row: RecruitingRow | null,
  action: 'edit' | 'status' | 'archive' = 'edit',
  opener?: HTMLElement
) {
  if (
    !alive ||
    loading.value ||
    !!error.value ||
    refreshPending.value ||
    gate.current.value ||
    v3Session.state.status !== 'ready'
  )
    return
  const lease = gate.acquire()
  if (!lease) return
  profileLease = lease
  editorFocus.remember(event, opener)
  const attempt = ++openingGeneration
  const path = route.fullPath
  const session = v3Session.version()
  try {
    const current = row ? await detail(resource.value, row.id) : null
    if (!positions.value && !row) options.value = await readV3<Position[]>('/positions/options')
    if (
      !alive ||
      !gate.owns(lease) ||
      attempt !== openingGeneration ||
      route.fullPath !== path ||
      v3Session.version() !== session ||
      v3Session.state.status !== 'ready'
    )
      return
    editor.value = { row: current, action, key: ++editorKey }
  } catch (e) {
    if (attempt === openingGeneration && route.fullPath === path && v3Session.version() === session)
      error.value = e instanceof Error ? e.message : '无法打开表单'
  } finally {
    if (!editor.value) {
      gate.release(lease)
      if (profileLease === lease) profileLease = null
    }
  }
}
const editorFocus = useEditorFocus('.v3-recruiting')
async function cancelWithFocus() {
  await closeProfile()
  await editorFocus.restore()
}
async function closeProfile() {
  const lease = profileLease
  openingGeneration++
  editor.value = null
  await nextTick()
  if (lease) gate.release(lease)
  if (profileLease === lease) profileLease = null
}
function showDetail(row: RecruitingRow, event: MouseEvent) {
  rememberApplication(event, row.id)
  void router.push('/candidates/' + row.id)
}
function saved() {
  void closeProfile().then(editorFocus.restore)
  if (positions.value) void loadPositionCounts()
  void load()
}
watch(
  [() => route.fullPath, () => v3Session.state.user?.id],
  () => {
    query.invalidate()
    selected.value = null
    profileExpanded.value = false
    navigationMessage.value = detailNotice.value = ''
    activeTab.value = focusedTab.value = 'task'
    decision.value = offer.value = null
    editorTab.value = null
    refreshPending.value = false
    void closeProfile()
    search.value = String(route.query.q ?? '')
    status.value = String(
      route.query[positions.value ? 'status' : 'applicationStatus'] ??
        (positions.value ? '' : 'active')
    )
    stage.value = String(route.query.stage ?? '')
    positionFilter.value = String(route.query.positionId ?? '')
    void load()
  },
  { immediate: true }
)
watch(
  [positions, isDetail, sessionReady, () => v3Session.state.user?.id],
  ([isPositions, detail, ready]) => {
    positionMetricsRead.invalidate()
    positionHistoryRead.invalidate()
    if (!ready || detail) return
    if (isPositions) void loadPositionCounts()
    else void loadHistoryPositions()
  },
  { immediate: true }
)
watch(sessionReady, (ready) => {
  if (!ready) {
    query.invalidate()
    loadRound++
  } else void load()
})
watch(
  [() => gate.current.value, () => v3Session.state.status],
  ([lease, status]) => {
    if (!lease && status === 'ready' && refreshPending.value) void load()
  },
  { flush: 'post' }
)
onUnmounted(() => {
  editorFocus.clear()
  alive = false
  if (profileLease) gate.release(profileLease)
  openingGeneration++
  query.invalidate()
  positionMetricsRead.invalidate()
  positionHistoryRead.invalidate()
})
</script>
