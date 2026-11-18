import type React from 'react';
import {
  Button,
  Form,
  Select,
  Tag,
  Tooltip,
  Alert,
  Popconfirm,
  InputNumber,
  Radio,
  Switch,
  App,
  TimePicker,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  AppstoreOutlined,
  SendOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  SettingOutlined,
  PlusOutlined,
  DeleteOutlined,
  ThunderboltOutlined,
  WarningOutlined,
  TeamOutlined,
  ReloadOutlined,
  SyncOutlined,
  EditOutlined,
  KeyOutlined,
  CloseOutlined,
  ThunderboltFilled,
  SafetyCertificateOutlined,
  FileTextOutlined,
  ShareAltOutlined,
  SaveOutlined,
  UserOutlined,
  DeploymentUnitOutlined,
  EyeInvisibleOutlined,
  BulbOutlined,
  BarChartOutlined,
  AimOutlined,
} from '@ant-design/icons';
import type { FormInstance } from 'antd';
import type { SocialAccount, PostMode } from './types';

interface ComposeTargetSectionProps {
  form: FormInstance<any>;
  postMode: PostMode;
  groupStaggerInterval: number;
  setGroupStaggerInterval: React.Dispatch<React.SetStateAction<number>>;
  groupTimingMode: 'SPREAD_DAY' | 'STAGGER';
  setGroupTimingMode: React.Dispatch<React.SetStateAction<'SPREAD_DAY' | 'STAGGER'>>;
  groupSpreadStart: Dayjs;
  setGroupSpreadStart: React.Dispatch<React.SetStateAction<Dayjs>>;
  groupSpreadEnd: Dayjs;
  setGroupSpreadEnd: React.Dispatch<React.SetStateAction<Dayjs>>;
  validLinkCount: number;
  setQuickCookieModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setQuickCookieTargetId: React.Dispatch<React.SetStateAction<number>>;
  playwrightAccounts: SocialAccount[];
  personalAccountTargets: SocialAccount[];
  accountTargetValue: (account: SocialAccount) => string;
  pageCountByCUser: Map<string, number>;
  viaNameOf: (account: SocialAccount) => string;
  coAdminViasByPageName: Map<string, string[]>;
  groupAccountsWithId: SocialAccount[];
  selectedTargetAccount: SocialAccount;
  isCurrentTargetExpired: boolean;
  hasMultipleGroupsSelected: boolean;
  setIsMultiDistributeActive: React.Dispatch<React.SetStateAction<boolean>>;
  setMultiSelectedTargets: React.Dispatch<React.SetStateAction<string[]>>;
  setDistributionStrategy: React.Dispatch<React.SetStateAction<"ROUND_ROBIN" | "DAILY_QUOTA" | "STAGGERED">>;
  distributionStrategy: "ROUND_ROBIN" | "DAILY_QUOTA" | "STAGGERED";
  staggerIntervalMinutes: number;
  setStaggerIntervalMinutes: React.Dispatch<React.SetStateAction<number>>;
  isAnonymous: boolean;
  setIsAnonymous: React.Dispatch<React.SetStateAction<boolean>>;
  setGroupDistributionMode: React.Dispatch<React.SetStateAction<"PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL">>;
  groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL";
  activeSelectedGroupIds: string[];
  activeSelectedFanpageIds: string[];
  validPersonalVias: SocialAccount[];
  twoMainVias: SocialAccount[];
  twoMainViasDisplayNames: string;
  isTwoViaActive: boolean;
  handleQuickSelectTwoVias: () => void;
  handleQuickSelectAllVias: () => void;
  handleQuickSelectAllPages: () => void;
  selectedCoAdminPageNames: string[];
  isAllCoAdminsSelected: boolean;
  handleAutoSelectBothViasForSelectedPages: () => void;
  handleResetToSingleTarget: () => void;
  savedPresets: { id: string; name: string; postMode: "GROUP_ONLY" | "FANPAGE_ONLY" | "FANPAGE_AND_GROUP"; groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL"; selectedFanpageIds: string[]; selectedGroupIds: string[]; isAnonymous?: boolean; }[];
  selectedPresetId: string;
  setSelectedPresetId: React.Dispatch<React.SetStateAction<string>>;
  setSavePresetModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setNewPresetName: React.Dispatch<React.SetStateAction<string>>;
  setManagePresetsModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setEditingPreset: React.Dispatch<React.SetStateAction<{ id: string; name: string; }>>;
  setEditingPresetName: React.Dispatch<React.SetStateAction<string>>;
  applyPreset: (preset: { id: string; name: string; postMode: "GROUP_ONLY" | "FANPAGE_ONLY" | "FANPAGE_AND_GROUP"; groupDistributionMode: "PAGE_PER_GROUP" | "ROUND_ROBIN_POSTS" | "CROSS_ALL"; selectedFanpageIds: string[]; selectedGroupIds: string[]; isAnonymous?: boolean; }) => void;
  handleUpdatePresetWithCurrent: (presetId: string) => void;
  handleDeletePreset: (presetId: string, e?: React.MouseEvent<Element, MouseEvent>) => void;
  handleAutoSpreadPagesForGroups: () => void;
  unifiedAccountOptions: any[];
  unifiedGroupOptions: { value: string; filterLabel: string; label: React.JSX.Element; }[];
  calculatedTotalQueueCount: number;
  setGroupCheckModalVisible: React.Dispatch<React.SetStateAction<boolean>>;
}

// Bước "Chọn nơi xuất bản" của form soạn bài — tách từ PlaywrightPoster, state vẫn nằm ở trang cha
export default function ComposeTargetSection({
  form,
  postMode,
  groupStaggerInterval,
  setGroupStaggerInterval,
  groupTimingMode,
  setGroupTimingMode,
  groupSpreadStart,
  setGroupSpreadStart,
  groupSpreadEnd,
  setGroupSpreadEnd,
  validLinkCount,
  setQuickCookieModalOpen,
  setQuickCookieTargetId,
  playwrightAccounts,
  personalAccountTargets,
  accountTargetValue,
  pageCountByCUser,
  viaNameOf,
  coAdminViasByPageName,
  groupAccountsWithId,
  selectedTargetAccount,
  isCurrentTargetExpired,
  hasMultipleGroupsSelected,
  setIsMultiDistributeActive,
  setMultiSelectedTargets,
  setDistributionStrategy,
  distributionStrategy,
  staggerIntervalMinutes,
  setStaggerIntervalMinutes,
  isAnonymous,
  setIsAnonymous,
  setGroupDistributionMode,
  groupDistributionMode,
  activeSelectedGroupIds,
  activeSelectedFanpageIds,
  validPersonalVias,
  twoMainVias,
  twoMainViasDisplayNames,
  isTwoViaActive,
  handleQuickSelectTwoVias,
  handleQuickSelectAllVias,
  handleQuickSelectAllPages,
  selectedCoAdminPageNames,
  isAllCoAdminsSelected,
  handleAutoSelectBothViasForSelectedPages,
  handleResetToSingleTarget,
  savedPresets,
  selectedPresetId,
  setSelectedPresetId,
  setSavePresetModalOpen,
  setNewPresetName,
  setManagePresetsModalOpen,
  setEditingPreset,
  setEditingPresetName,
  applyPreset,
  handleUpdatePresetWithCurrent,
  handleDeletePreset,
  handleAutoSpreadPagesForGroups,
  unifiedAccountOptions,
  unifiedGroupOptions,
  calculatedTotalQueueCount,
  setGroupCheckModalVisible,
}: ComposeTargetSectionProps) {
  const { message } = App.useApp();
  return (
    <section id="poster-step-2" className="poster-form-section">
      <div className="poster-section-heading">
        <span className="poster-step-number">2</span>
        <div>
          <h2>Chọn nơi xuất bản</h2>
          <p>Chọn đúng Fanpage/Nick và nhóm nhận bài.</p>
        </div>
      </div>

      {/* Cảnh báo nổi bật khi Fanpage đang chọn bị hết hạn Cookie */}
      {isCurrentTargetExpired && (
        <Alert
          type="error"
          showIcon
          message={
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-semibold text-red-400">
                Fanpage <b>{selectedTargetAccount?.pageName || selectedTargetAccount?.platformAccountId}</b> đang <b>BỊ HẾT HẠN COOKIE</b>! Bài đăng chắc chắn sẽ bị lỗi nếu không cập nhật cookie mới.
              </span>
              <Button
                type="primary"
                danger
                size="small"
                icon={<KeyOutlined />}
                onClick={() => {
                  setQuickCookieTargetId(selectedTargetAccount?.id);
                  setQuickCookieModalOpen(true);
                }}
                className="font-extrabold text-xs rounded-lg h-8 px-3 shadow-md shrink-0 self-start sm:self-auto"
              >
                Cập Nhật Cookie Ngay
              </Button>
            </div>
          }
          className="rounded-2xl border-red-500/30 bg-red-950/40 mb-4 shadow-sm"
        />
      )}

      {/* THANH COMBO THƯỜNG DÙNG (SPEED PRESETS BAR) */}
      <div className="poster-preset-bar">
        {/* Khối chọn cấu hình */}
        <div className="flex items-center gap-2.5 flex-wrap flex-1 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center justify-center shrink-0">
            <AppstoreOutlined className="text-xs" />
          </div>
          <span className="text-xs font-semibold text-slate-300 shrink-0">Cấu hình lưu sẵn:</span>
          <Select
            value={selectedPresetId}
            placeholder={savedPresets.length === 0 ? "Chưa có cấu hình nào được lưu" : "Chọn cấu hình để áp dụng nhanh..."}
            className="poster-preset-select"
            size="middle"
            allowClear
            disabled={savedPresets.length === 0}
            onChange={(val) => {
              setSelectedPresetId(val || null);
              const matched = savedPresets.find((p) => p.id === val);
              if (matched) applyPreset(matched);
            }}
            optionRender={(option) => {
              const p = savedPresets.find((item) => item.id === option.value);
              if (!p) return option.label;
              return (
                <div className="flex items-center justify-between gap-2 py-0.5 group">
                  <span className="truncate text-[13px] font-medium text-slate-100">
                    {p.name} <span className="text-slate-300 font-normal">({p.selectedGroupIds.length > 0 ? `${p.selectedGroupIds.length} nhóm` : 'Tự chọn nhóm'} • {p.selectedFanpageIds.length} page)</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Tooltip title="Đổi tên cấu hình">
                      <Button
                        size="small"
                        type="text"
                        icon={<EditOutlined className="text-xs text-sky-400" />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPreset({ id: p.id, name: p.name });
                          setEditingPresetName(p.name);
                        }}
                        className="!p-1 h-7 w-7 text-slate-300 hover:text-white hover:bg-slate-700"
                      />
                    </Tooltip>
                    <Tooltip title="Xóa cấu hình">
                      <Popconfirm
                        title="Xóa cấu hình này?"
                        onConfirm={(e) => {
                          e?.stopPropagation();
                          handleDeletePreset(p.id);
                        }}
                        okText="Xóa"
                        cancelText="Hủy"
                        okButtonProps={{ danger: true, size: 'small' }}
                        cancelButtonProps={{ size: 'small' }}
                      >
                        <Button
                          size="small"
                          type="text"
                          icon={<DeleteOutlined className="text-xs text-rose-400" />}
                          onClick={(e) => e.stopPropagation()}
                          className="!p-1 h-7 w-7 text-slate-300 hover:text-rose-300 hover:bg-rose-950/40"
                        />
                      </Popconfirm>
                    </Tooltip>
                  </div>
                </div>
              );
            }}
            options={savedPresets.map((p) => ({
              value: p.id,
              label: `${p.name} (${p.selectedGroupIds.length > 0 ? `${p.selectedGroupIds.length} nhóm` : 'Tự chọn nhóm'} • ${p.selectedFanpageIds.length} page)`,
            }))}
          />

          {/* Khi đang chọn một preset, hiển thị nút Cập nhật nhanh với thiết lập hiện tại */}
          {selectedPresetId && (
            <Tooltip title="Lưu các Nhóm và Page đang tick chọn hiện tại vào cấu hình này">
              <Button
                size="middle"
                icon={<SaveOutlined className="text-emerald-400 text-xs" />}
                onClick={() => handleUpdatePresetWithCurrent(selectedPresetId)}
                className="text-xs font-semibold rounded-lg bg-emerald-950/40 border-emerald-600/50 text-emerald-300 hover:text-white hover:bg-emerald-800/60 shrink-0"
              >
                Cập nhật
              </Button>
            </Tooltip>
          )}
        </div>

        {/* Khối các nút hành động */}
        <div className="flex items-center gap-2 flex-wrap">
          {activeSelectedGroupIds.length > 0 && (
            <Button
              size="middle"
              icon={<SendOutlined className="text-sky-400 text-xs" />}
              onClick={handleAutoSpreadPagesForGroups}
              className="text-xs font-medium rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white shrink-0"
              title="Tự động bốc số Page bằng đúng số lượng nhóm đã chọn"
            >
              Rải Page đều Nhóm
            </Button>
          )}
          <Tooltip title="Xem, sửa tên, cập nhật hoặc xóa các cấu hình đã lưu">
            <Button
              size="middle"
              icon={<SettingOutlined className="text-slate-300 text-xs" />}
              onClick={() => setManagePresetsModalOpen(true)}
              className="text-xs font-medium rounded-lg bg-slate-800 border-slate-700 text-slate-300 hover:text-white shrink-0"
            >
              Quản lý cấu hình
            </Button>
          </Tooltip>
          <Button
            type="primary"
            size="middle"
            icon={<PlusOutlined />}
            onClick={() => {
              if (activeSelectedGroupIds.length === 0 && activeSelectedFanpageIds.length === 0) {
                message.warning('Vui lòng chọn ít nhất 1 nhóm hoặc 1 Page trước khi lưu!');
                return;
              }
              setNewPresetName(`Combo ${activeSelectedGroupIds.length} Nhóm • ${activeSelectedFanpageIds.length} Page`);
              setSavePresetModalOpen(true);
            }}
            className="text-xs font-medium rounded-lg bg-blue-600 hover:bg-blue-500 text-white border-0 shadow-sm shrink-0"
          >
            Lưu mới
          </Button>
        </div>
      </div>

      {/* BƯỚC 2: KHUNG ĐIỀU KHIỂN XUẤT BẢN */}
      <div className="space-y-4">
        {/* Lưới 2 cột trực quan: Cột trái chọn Nhóm, Cột phải chọn Người đăng */}
        <div className={postMode !== 'FANPAGE_ONLY' ? 'grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch' : 'space-y-4'}>
          {/* NẾU LÀ GROUP_ONLY HOẶC FANPAGE_AND_GROUP: HIỂN THỊ KHUNG CHỌN NHÓM ĐẦU TIÊN ĐỂ LUỒNG TỰ NHIÊN HƠN */}
          {(postMode === 'GROUP_ONLY' || postMode === 'FANPAGE_AND_GROUP') && (
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-emerald-500/30 shadow-xl backdrop-blur-md flex flex-col justify-between">
              <div className="space-y-3.5">
                <div className="flex items-start sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400 text-sm shadow-sm shrink-0">
                      <TeamOutlined />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                        <span>Nhóm Facebook nhận bài</span>
                        {activeSelectedGroupIds.length > 0 ? (
                          <Tag color="emerald" className="!rounded-full font-bold text-xs !m-0 border-0 bg-emerald-500/20 text-emerald-300 inline-flex items-center gap-1">
                            <CheckCircleOutlined /> Đã chọn {activeSelectedGroupIds.length} nhóm
                          </Tag>
                        ) : (
                          <Tag color="warning" className="!rounded-full font-semibold text-xs !m-0 border-0 bg-amber-500/20 text-amber-300 inline-flex items-center gap-1">
                            <WarningOutlined /> Chưa chọn nhóm
                          </Tag>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5 truncate" title={`Chọn các nhóm Facebook sẽ nhận bài viết xuất bản (${groupAccountsWithId.length} Nhóm có sẵn)`}>
                        Chọn nhóm nhận bài ({groupAccountsWithId.length} nhóm có sẵn)
                      </div>
                    </div>
                  </div>

                  <Button
                    size="small"
                    icon={<SafetyCertificateOutlined className="text-emerald-400" />}
                    onClick={() => setGroupCheckModalVisible(true)}
                    className="text-xs text-emerald-300 hover:text-emerald-200 bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 rounded-xl h-8 px-2.5 font-semibold shrink-0 whitespace-nowrap"
                    title="Kiểm tra tư cách thành viên và sức khỏe nhóm Facebook"
                  >
                    Kiểm tra nhóm
                  </Button>
                </div>

                <Form.Item
                  name={postMode === 'GROUP_ONLY' ? 'targetGroupId' : 'groupNames'}
                  rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nhóm nhận bài' }]}
                  className="!mb-0"
                >
                  <Select
                    mode="multiple"
                    size="large"
                    placeholder="Gõ tên hoặc ID nhóm Facebook để tìm kiếm và chọn nhanh..."
                    showSearch
                    allowClear
                    optionFilterProp="filterLabel"
                    filterOption={(input, option: any) => {
                      const label = String(option?.filterLabel || option?.label || '').toLowerCase();
                      const query = input.toLowerCase();
                      if (label.includes(query)) return true;
                      const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                      return strip(label).includes(strip(query));
                    }}
                    className="w-full"
                    options={unifiedGroupOptions}
                  />
                </Form.Item>

                {unifiedGroupOptions.length === 0 && (
                  <div className="mt-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/30 flex items-center justify-between gap-3 text-xs text-emerald-200">
                    <span>Chưa có Nhóm Facebook nào trong danh sách. Hãy vào <b>Quản lý Nhóm</b> để khai báo các nhóm cần đăng.</span>
                    <Button size="small" type="primary" href="/groups" className="bg-emerald-600 hover:bg-emerald-500 rounded-lg text-xs font-semibold shrink-0">
                      Khai báo Nhóm ngay →
                    </Button>
                  </div>
                )}
              </div>

              {/* Đăng ẩn danh (chỉ với GROUP_ONLY) */}
              {postMode === 'GROUP_ONLY' && (
                <div className="mt-4 pt-2">
                  <div className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-3 ${isAnonymous
                      ? 'bg-amber-950/25 border-amber-500/40 shadow-sm'
                      : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
                    }`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-sm shrink-0 border transition-colors ${isAnonymous
                          ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                          : 'bg-slate-800/80 border-slate-700/60 text-slate-400'
                        }`}>
                        <EyeInvisibleOutlined />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-bold flex items-center gap-2 flex-wrap">
                          <span className={isAnonymous ? 'text-amber-200' : 'text-slate-100'}>
                            Đăng ẩn danh vào Group
                          </span>
                          {isAnonymous ? (
                            <Tag color="warning" className="!rounded-full !text-xs font-bold !m-0 !px-2 border-0 bg-amber-500/20 text-amber-300">
                              Ẩn danh tính {selectedTargetAccount?.pageName ? selectedTargetAccount.pageName.replace(/^👤\s*Nick Cá Nhân\s*\((.*)\)$/, '$1') : 'Nick cá nhân'}
                            </Tag>
                          ) : (
                            <span className="text-xs text-slate-300 font-normal">
                              Thành viên ẩn danh
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-300 truncate">
                          Xuất bản bài dưới tư cách "Thành viên ẩn danh", bảo vệ danh tính tài khoản thật.
                        </div>
                      </div>
                    </div>
                    <Switch
                      checked={isAnonymous}
                      onChange={(checked) => setIsAnonymous(checked)}
                      className={isAnonymous ? '!bg-amber-500' : ''}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

        {/* KHUNG CHỌN TÀI KHOẢN ĐẠI DIỆN ĐĂNG BÀI */}
        <div className="p-4 sm:p-5 rounded-2xl bg-slate-900/80 border border-sky-500/30 shadow-xl space-y-4 backdrop-blur-md flex flex-col justify-between">
          {/* Header: Tiêu đề & Trạng thái phân bổ đang kích hoạt + Nút reset */}
            <div className="flex items-start sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 text-sm shadow-sm shrink-0">
                  <ShareAltOutlined />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-100 flex items-center gap-2 flex-wrap">
                    <span>
                      {postMode === 'FANPAGE_ONLY'
                        ? 'Kênh Fanpage / Nick xuất bản'
                        : postMode === 'FANPAGE_AND_GROUP'
                        ? 'Fanpage xuất bản (Đăng tường & Share Nhóm)'
                        : 'Tài khoản đại diện đăng bài'}
                    </span>
                    {isTwoViaActive ? (
                      <Tag className="!rounded-md font-semibold text-xs !m-0 border border-blue-500/30 bg-blue-500/15 text-blue-300">
                        2 Via song song (50/50)
                      </Tag>
                    ) : activeSelectedFanpageIds.length > 1 ? (
                      <Tag className="!rounded-md font-semibold text-xs !m-0 border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
                        Đang chia {activeSelectedFanpageIds.length} tài khoản
                      </Tag>
                    ) : activeSelectedFanpageIds.length === 1 ? (
                      <Tag className="!rounded-md font-semibold text-xs !m-0 border border-slate-700 bg-slate-800 text-slate-300">
                        1 tài khoản
                      </Tag>
                    ) : null}
                  </div>
                  <div
                    className="text-xs text-slate-400 mt-0.5 truncate"
                    title={
                      postMode === 'FANPAGE_ONLY'
                        ? 'Chọn 1 hoặc nhiều Fanpage/Via để đăng bài'
                        : postMode === 'FANPAGE_AND_GROUP'
                        ? 'Chọn Fanpage xuất bản bài gốc (sau đó bài sẽ được chia sẻ vào các Nhóm đã chọn):'
                        : 'Chọn 1 hoặc nhiều Nick/Page đại diện để đăng vào các Nhóm:'
                    }
                  >
                    {postMode === 'FANPAGE_ONLY'
                      ? 'Chọn Fanpage/Via để đăng bài:'
                      : postMode === 'FANPAGE_AND_GROUP'
                      ? 'Chọn Fanpage đăng bài gốc:'
                      : 'Chọn Nick/Page đại diện để đăng vào Nhóm:'}
                  </div>
                </div>
              </div>

              {/* Nút reset nếu đang chọn nhiều tài khoản */}
              {activeSelectedFanpageIds.length > 1 && (
                <Button
                  size="small"
                  type="text"
                  icon={<ReloadOutlined />}
                  onClick={handleResetToSingleTarget}
                  className="text-xs text-slate-300 hover:text-rose-300 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl h-8 px-2.5 shrink-0 whitespace-nowrap"
                >
                  Về 1 tài khoản
                </Button>
              )}
            </div>

          {/* Hướng dẫn ngắn gọn, dễ hiểu cho người mới */}
          <div className="text-xs text-slate-300 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/80 flex items-start gap-2 select-none">
            <BulbOutlined className="text-sky-400 shrink-0 text-sm mt-0.5" />
            <span className="leading-relaxed">
              {postMode === 'FANPAGE_AND_GROUP' ? (
                <><b>Quy trình:</b> Bài viết sẽ được xuất bản lên tường <b>Fanpage</b> đã chọn dưới đây, sau đó tự động <b>chia sẻ vào các Nhóm</b> bạn đã tick ở trên!</>
              ) : postMode === 'GROUP_ONLY' ? (
                <><b>Hướng dẫn:</b> Chọn Fanpage hoặc Nick cá nhân để đứng tên đăng bài vào Nhóm. Nếu Nhóm không cho Fanpage đăng, hệ thống sẽ <b>tự động chuyển sang Nick cá nhân sở hữu</b> để bài viết luôn được đăng thành công! (Nếu chọn từ 2 tài khoản trở lên, hệ thống sẽ <b>tự động xoay vòng chia đều bài</b> chống checkpoint).</>
              ) : (
                <><b>Hướng dẫn:</b> Chọn Fanpage hoặc Nick cá nhân để đăng bài lên dòng thời gian. Có thể chọn nhiều tài khoản để <b>chia đều bài đăng</b> tự động!</>
              )}
            </span>
          </div>

          {/* Dòng 1: Chọn nhanh dạng pill gọn gàng, rõ nghĩa */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1.5">
              <ThunderboltOutlined className="text-blue-400" /> Chọn nhanh:
            </span>

            {/* 1 Tài khoản đơn lẻ */}
            <button
              type="button"
              onClick={handleResetToSingleTarget}
              className={`h-8 px-3 rounded-lg text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 ${
                activeSelectedFanpageIds.length === 1 && !isTwoViaActive
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/50 shadow-sm ring-1 ring-blue-500/30'
                  : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white'
              }`}
              title="Đăng bằng 1 tài khoản đơn lẻ (Chế độ tiêu chuẩn)"
            >
              <UserOutlined className="text-xs text-slate-400" />
              <span>1 Tài khoản đơn lẻ</span>
              {activeSelectedFanpageIds.length === 1 && !isTwoViaActive && <CheckCircleOutlined className="text-xs text-blue-400" />}
            </button>

            {/* Tất cả Page */}
            {playwrightAccounts.length > 0 && (
              <button
                type="button"
                onClick={handleQuickSelectAllPages}
                className="h-8 px-3 rounded-lg text-xs font-semibold transition-all border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white cursor-pointer flex items-center gap-1.5"
                title={`Tự động chia đều bài cho toàn bộ ${playwrightAccounts.length} Fanpage`}
              >
                <FileTextOutlined className="text-xs text-blue-400" />
                <span>Tất cả {playwrightAccounts.length} Page</span>
              </button>
            )}

            {/* Tất cả Nick cá nhân (Via) */}
            {validPersonalVias.length > 0 && (
              <button
                type="button"
                onClick={handleQuickSelectAllVias}
                className="h-8 px-3 rounded-lg text-xs font-semibold transition-all border border-slate-700/80 bg-slate-800/80 text-slate-300 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white cursor-pointer flex items-center gap-1.5"
                title={`Tự động chia đều bài cho toàn bộ ${validPersonalVias.length} Nick Via cá nhân`}
              >
                <TeamOutlined className="text-xs text-emerald-400" />
                <span>Tất cả {validPersonalVias.length} Nick Via</span>
              </button>
            )}

            {/* Song song 2 Via (Nếu hệ thống có từ 2 Via) */}
            {validPersonalVias.length >= 2 && (
              <button
                type="button"
                onClick={handleQuickSelectTwoVias}
                className={`h-8 px-3 rounded-lg text-xs font-semibold transition-all border cursor-pointer flex items-center gap-1.5 ${
                  isTwoViaActive
                    ? 'bg-blue-500/20 text-blue-300 border-blue-500/50 shadow-sm ring-1 ring-blue-500/30'
                    : 'bg-slate-800/80 text-slate-300 border-slate-700/80 hover:border-slate-600 hover:bg-slate-700/80 hover:text-white'
                }`}
                title="Dùng 2 Nick Via chạy song song để tăng gấp đôi tốc độ và chống checkpoint"
              >
                <ThunderboltOutlined className="text-xs text-amber-400" />
                <span>Song song 2 Via (Chống Spam)</span>
                {isTwoViaActive && <CheckCircleOutlined className="text-xs text-blue-400" />}
              </button>
            )}

            {/* Page đồng quản trị Co-Admin (Chỉ hiện khi có các page được 2 Via cùng quản lý) */}
            {playwrightAccounts.some((a) => {
              const norm = (a.pageName || a.platformAccountId).trim().toLowerCase();
              return (coAdminViasByPageName.get(norm) || []).length > 1 && a.tokenStatus !== 'EXPIRED';
            }) && (
              <button
                type="button"
                onClick={() => {
                  const sharedVals = playwrightAccounts
                    .filter((a) => {
                      const norm = (a.pageName || a.platformAccountId).trim().toLowerCase();
                      const coAdmins = coAdminViasByPageName.get(norm) || [];
                      return coAdmins.length > 1 && a.tokenStatus !== 'EXPIRED';
                    })
                    .map((a) => accountTargetValue(a));
                  if (sharedVals.length === 0) {
                    message.warning('Không tìm thấy Page đồng quản trị nào!');
                    return;
                  }
                  form.setFieldValue('targetFanpageId', sharedVals);
                  setIsMultiDistributeActive(true);
                  setMultiSelectedTargets(sharedVals);
                  setDistributionStrategy('ROUND_ROBIN');
                  setGroupDistributionMode('PAGE_PER_GROUP');
                  message.success('⚡ Đã bật chia bài cho các Page có nhiều Via đồng quản trị!');
                }}
                className="h-8 px-3 rounded-lg text-xs font-semibold transition-all border border-purple-500/40 bg-purple-950/40 text-purple-300 hover:border-purple-400 hover:bg-purple-900/60 hover:text-white cursor-pointer flex items-center gap-1.5"
                title="Chọn các Fanpage có nhiều Via cùng làm quản trị viên để tự động chia đều bài viết chạy song song"
              >
                <ShareAltOutlined className="text-xs text-purple-400" />
                <span>Page đồng quản trị (Co-Admin)</span>
              </button>
            )}
          </div>

          {/* Dòng 2: Ô Select tìm kiếm thông minh */}
          <div>
            <Form.Item
              name="targetFanpageId"
              rules={[{ required: true, message: 'Vui lòng chọn ít nhất 1 nơi xuất bản' }]}
              className="!mb-0"
            >
              <Select
                mode="multiple"
                size="large"
                placeholder="Gõ tên Page hoặc Nick cá nhân để tìm kiếm và chọn nhanh..."
                showSearch
                allowClear
                optionFilterProp="filterLabel"
                filterOption={(input, option: any) => {
                  const label = String(option?.filterLabel || option?.label || '').toLowerCase();
                  const query = input.toLowerCase();
                  if (label.includes(query)) return true;
                  const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
                  return strip(label).includes(strip(query));
                }}
                tagRender={(tagProps) => {
                  const { value, closable, onClose } = tagProps;
                  const acc = playwrightAccounts.find((a) => accountTargetValue(a) === value) ||
                              personalAccountTargets.find((a) => accountTargetValue(a) === value);
                  const name = acc ? (acc.pageName || acc.platformAccountId) : String(value);
                  const isPersonal = acc?.platform === 'FACEBOOK_PROFILE' || acc?.platform === 'FACEBOOK_PERSONAL';
                  const viaName = acc ? viaNameOf(acc) : '';
                  const normName = name.trim().toLowerCase();
                  const coAdmins = coAdminViasByPageName.get(normName) || [];
                  const isCoAdmin = coAdmins.length > 1;

                  return (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-slate-800 border border-slate-700 text-xs font-medium text-slate-200 mr-2 my-1 shadow-sm">
                      {isPersonal ? <UserOutlined className="text-slate-400 text-xs" /> : <FileTextOutlined className="text-slate-400 text-xs" />}
                      <span className="font-semibold text-slate-100">{name}</span>
                      {isCoAdmin && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-bold bg-purple-500/20 text-purple-300 border border-purple-500/35" title="Trang có nhiều Nick Via cùng làm quản trị viên">
                          Co-Admin
                        </span>
                      )}
                      {viaName && <span className="text-xs font-normal text-slate-300 bg-slate-900/60 px-1.5 py-0.5 rounded border border-slate-700/60">qua {viaName}</span>}
                      {closable && (
                        <CloseOutlined
                          onClick={onClose}
                          className="text-slate-300 hover:text-rose-400 text-xs ml-0.5 cursor-pointer transition-colors"
                        />
                      )}
                    </span>
                  );
                }}
                onChange={(vals) => {
                  const list = Array.isArray(vals) ? vals : [vals];
                  setIsMultiDistributeActive(list.length > 1);
                  setMultiSelectedTargets(list);
                  if (list.length > 1) {
                    setGroupDistributionMode('PAGE_PER_GROUP');
                  }
                }}
                className="w-full"
                options={unifiedAccountOptions}
              />
            </Form.Item>

            {unifiedAccountOptions.length === 0 && (
              <div className="mt-2.5 p-3 rounded-xl bg-blue-950/40 border border-blue-500/30 flex items-center justify-between gap-3 text-xs text-blue-200">
                <span>Chưa có Fanpage hoặc Nick Via cá nhân nào kết nối. Vui lòng vào <b>Quản lý kết nối</b> để thêm tài khoản trước khi đăng.</span>
                <Button size="small" type="primary" href="/connections" className="bg-blue-600 hover:bg-blue-500 rounded-lg text-xs font-semibold shrink-0">
                  Thêm kết nối ngay →
                </Button>
              </div>
            )}

            {/* Báo hiệu và nút hỗ trợ thông minh khi chọn Page đồng quản trị (Co-admin) */}
            {selectedCoAdminPageNames.length > 0 && !isAllCoAdminsSelected && (
              <div className="mt-2.5 p-3 rounded-xl bg-purple-950/40 border border-purple-500/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-sm">
                <div className="flex items-center gap-2 text-xs text-purple-200">
                  <ThunderboltFilled className="text-purple-400 text-sm shrink-0" />
                  <span>
                    Trang <b>{selectedCoAdminPageNames.join(', ')}</b> có <b>nhiều Nick Via cùng quản lý</b>. Bạn có muốn kích hoạt cả 2 Via để chia đều bài đăng chạy song song không?
                  </span>
                </div>
                <Button
                  size="small"
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  className="bg-purple-600 hover:bg-purple-500 text-xs font-bold rounded-lg h-8 px-3 shrink-0"
                  onClick={handleAutoSelectBothViasForSelectedPages}
                >
                  Bật song song 2 Via
                </Button>
              </div>
            )}

            {selectedCoAdminPageNames.length > 0 && isAllCoAdminsSelected && (
              <div className="mt-2.5 p-3 rounded-xl bg-emerald-950/40 border border-emerald-500/40 flex items-center justify-between gap-2 text-xs text-emerald-200">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold flex items-center justify-center shrink-0">
                    <CheckCircleOutlined />
                  </span>
                  <span>
                    Đang bật <b>chạy song song cho trang {selectedCoAdminPageNames.join(', ')}</b>: Hệ thống sẽ tự động dùng cả 2 Via luân phiên đăng bài vào các nhóm để chống checkpoint!
                  </span>
                </div>
                <Button
                  size="small"
                  type="text"
                  onClick={handleResetToSingleTarget}
                  className="text-xs text-slate-300 hover:text-rose-300 bg-slate-800/80 hover:bg-slate-700 h-7 px-2.5 rounded-lg shrink-0 border border-slate-700"
                >
                  Về 1 Via duy nhất
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Tóm tắt nhanh Nơi đăng & Người đăng */}
        {postMode !== 'FANPAGE_ONLY' && (
          <div className="px-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 text-xs text-slate-300 flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-emerald-400 font-bold inline-flex items-center gap-1.5">
                <TeamOutlined /> {activeSelectedGroupIds.length} Nhóm nhận bài
              </span>
              <span className="text-slate-600">→</span>
              <span className="text-sky-400 font-bold inline-flex items-center gap-1.5">
                <UserOutlined /> {activeSelectedFanpageIds.length} Người đăng / Page đại diện
              </span>
            </span>
            <span className="text-slate-300 text-xs inline-flex items-center gap-1.5">
              {activeSelectedGroupIds.length === 0 ? (
                <><WarningOutlined className="text-amber-400" /> Hãy chọn ít nhất 1 nhóm ở cột bên trái</>
              ) : (
                <><CheckCircleOutlined className="text-emerald-400" /> Sẵn sàng xuất bản</>
              )}
            </span>
          </div>
        )}

          {/* Tự động hiện cấu hình phân phối đa kênh khi FANPAGE_ONLY và chọn nhiều tài khoản */}
          {postMode === 'FANPAGE_ONLY' && activeSelectedFanpageIds.length > 1 && (
            <div className="p-4 bg-slate-950/70 rounded-xl border border-indigo-900/60 space-y-3">
              <div className="flex items-center justify-between text-xs sm:text-sm font-bold text-indigo-300">
                <span className="flex items-center gap-2">
                  <ThunderboltFilled className="text-amber-400" /> Cài đặt phân phối bài cho {activeSelectedFanpageIds.length} tài khoản:
                </span>
                <Tag color="cyan" className="!rounded-full font-bold text-xs !m-0">TỰ ĐỘNG CHIA BÀI</Tag>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                    Thuật toán phân chia nội dung:
                  </label>
                  <Select
                    size="middle"
                    value={distributionStrategy}
                    onChange={(val) => setDistributionStrategy(val)}
                    className="w-full"
                    options={[
                      { value: 'ROUND_ROBIN', label: 'Xoay vòng đều (Bài 1 → Kênh A, Bài 2 → Kênh B...)' },
                      { value: 'DAILY_QUOTA', label: 'Cân bằng theo chỉ tiêu ngày (Ưu tiên kênh thiếu bài)' },
                    ]}
                  />
                </div>

              </div>
            </div>
          )}
        </div>

        {/* Chế độ phân bổ Nhóm & Page linh hoạt khi chọn N Nhóm và N Page */}
        {(postMode === 'GROUP_ONLY' || postMode === 'FANPAGE_AND_GROUP') && activeSelectedGroupIds.length > 0 && (
          <div className="p-4 sm:p-5 rounded-2xl border border-indigo-500/40 bg-gradient-to-r from-slate-900/90 via-indigo-950/40 to-slate-900/90 shadow-xl space-y-4 backdrop-blur-md">
            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5 border-b border-indigo-500/20 pb-3">
              <div className="flex items-start sm:items-center gap-2.5 min-w-0 flex-1">
                <div className="w-8 h-8 rounded-xl bg-indigo-600/30 border border-indigo-400/40 flex items-center justify-center text-indigo-300 shrink-0 mt-0.5 sm:mt-0">
                  <DeploymentUnitOutlined className="text-base" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-100 flex flex-wrap items-center gap-2">
                    <span>Phân bổ Page / Nick đăng bài vào {activeSelectedGroupIds.length} Nhóm</span>
                    <Tag color="cyan" className="!rounded-full !text-xs font-bold shrink-0 m-0">Smart Allocation</Tag>
                  </div>
                  <div className="text-[13px] text-slate-300 mt-0.5">
                    Tuỳ chỉnh số Page xuất bản (1 Page, 2 Page hoặc {activeSelectedGroupIds.length} Page) cho {activeSelectedGroupIds.length} Nhóm đã chọn.
                  </div>
                </div>
              </div>
              <Radio.Group
                value={groupDistributionMode}
                onChange={(e) => setGroupDistributionMode(e.target.value)}
                buttonStyle="solid"
                size="middle"
                className="shrink-0 flex flex-wrap sm:flex-nowrap"
              >
                <Radio.Button value="PAGE_PER_GROUP" className="text-xs">
                  <span className="inline-flex items-center gap-1"><SafetyCertificateOutlined /> 1 Page / Nhóm (Khuyên dùng)</span>
                </Radio.Button>
                <Radio.Button value="ROUND_ROBIN_POSTS" className="text-xs">
                  <span className="inline-flex items-center gap-1"><SyncOutlined /> Xoay vòng qua Nhóm</span>
                </Radio.Button>
                <Radio.Button value="CROSS_ALL" className="text-xs">
                  <span className="inline-flex items-center gap-1"><ThunderboltOutlined /> Tất cả Page × Tất cả Nhóm</span>
                </Radio.Button>
              </Radio.Group>
            </div>

            {/* Phân tích sơ đồ gán việc */}
            <div className="bg-slate-950/70 p-3.5 rounded-xl border border-indigo-900/50 text-xs text-slate-300 space-y-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2 font-semibold text-indigo-200">
                <span className="flex items-center gap-1.5">
                  <BarChartOutlined className="text-indigo-400" />
                  <span>Dự kiến phân bổ công việc:</span>
                  <span className="text-slate-400 font-normal">({validLinkCount || 10} bài × {activeSelectedGroupIds.length} Nhóm × {Math.max(1, activeSelectedFanpageIds.length)} Page)</span>
                </span>
                <Tag color="purple" className="!rounded-full font-mono text-xs px-2.5 py-0.5 font-bold inline-flex items-center gap-1">
                  <AimOutlined /> Tạo tổng cộng: {calculatedTotalQueueCount} bài queue
                </Tag>
              </div>

              {groupDistributionMode === 'PAGE_PER_GROUP' && (
                <div className="space-y-2 pt-0.5">
                  <div className="text-emerald-400 font-medium text-xs flex items-center gap-1.5">
                    <CheckCircleOutlined />
                    <span>Tất cả {validLinkCount || 10} bài đều đăng đủ vào cả {activeSelectedGroupIds.length} Nhóm (tổng cộng {(validLinkCount || 10) * Math.max(1, activeSelectedGroupIds.length)} bài queue). Các bài trong từng nhóm sẽ được luân phiên chia đều qua cả {Math.max(1, activeSelectedFanpageIds.length)} Page để không Page nào bị ôm nhiều bài.</span>
                  </div>
                </div>
              )}

              {groupDistributionMode === 'ROUND_ROBIN_POSTS' && (
                <div className="space-y-1.5 pt-0.5">
                  <div className="text-blue-400 font-medium text-xs flex items-center gap-1.5">
                    <SyncOutlined />
                    <span>{validLinkCount || 10} bài viết sẽ được xoay vòng chia đều lần lượt cho {activeSelectedGroupIds.length} nhóm (mỗi bài xuất hiện 1 nhóm, không trùng nội dung).</span>
                  </div>
                </div>
              )}

              {groupDistributionMode === 'CROSS_ALL' && (
                <div className="space-y-1.5 pt-0.5">
                  <div className="text-amber-400 font-medium text-xs flex items-center gap-1.5">
                    <WarningOutlined />
                    <span>Chế độ nhân bản dồn: Mỗi bài sẽ được đăng bởi TẤT CẢ {Math.max(1, activeSelectedFanpageIds.length)} Page/Nick vào TẤT CẢ {activeSelectedGroupIds.length} Nhóm ({validLinkCount || 10} bài x {activeSelectedGroupIds.length} Nhóm x {Math.max(1, activeSelectedFanpageIds.length)} Page = {calculatedTotalQueueCount} bài queue).</span>
                  </div>
                </div>
              )}
            </div>

            {/* Cấu hình phân bổ thời gian cho Nhóm: Rải đều cả ngày vs Cuốn chiếu nối đuôi */}
            {hasMultipleGroupsSelected && (
              <div className="pt-3 border-t border-indigo-500/20 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-lg bg-purple-500/20 border border-purple-500/30 flex items-center justify-center shrink-0 text-purple-300">
                      <ClockCircleOutlined className="text-sm" />
                    </div>
                    <div>
                      <div className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
                        <span>Phân bổ thời gian đăng giữa các nhóm:</span>
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        {groupTimingMode === 'SPREAD_DAY'
                          ? 'Tự động rải đều và xen kẽ các nhóm suốt cả ngày, không bị dồn cục vào 1 khung giờ.'
                          : 'Đăng các nhóm nối đuôi nhau liên tục với khoảng giãn cách ngắn.'}
                      </div>
                    </div>
                  </div>

                  <Radio.Group
                    size="small"
                    value={groupTimingMode}
                    onChange={(e) => setGroupTimingMode(e.target.value)}
                    className="self-start sm:self-auto shrink-0 bg-slate-950/80 p-0.5 rounded-lg border border-purple-500/30"
                  >
                    <Radio.Button value="SPREAD_DAY" className="!rounded-md text-xs font-semibold">
                      <span className="inline-flex items-center gap-1"><AimOutlined /> Rải đều cả ngày</span>
                    </Radio.Button>
                    <Radio.Button value="STAGGER" className="!rounded-md text-xs">
                      <span className="inline-flex items-center gap-1"><ClockCircleOutlined /> Cuốn chiếu ({groupStaggerInterval}p)</span>
                    </Radio.Button>
                  </Radio.Group>
                </div>

                {groupTimingMode === 'SPREAD_DAY' ? (
                  <div className="bg-slate-950/60 p-3 rounded-xl border border-purple-500/20 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-xs text-purple-200">
                        <span className="font-semibold text-slate-300">Khung giờ rải:</span>
                        <span>Từ</span>
                        <TimePicker
                          format="HH:mm"
                          size="small"
                          value={groupSpreadStart}
                          onChange={(t) => t && setGroupSpreadStart(t)}
                          className="w-24 bg-slate-900 border-purple-500/30"
                        />
                        <span>Đến</span>
                        <TimePicker
                          format="HH:mm"
                          size="small"
                          value={groupSpreadEnd}
                          onChange={(t) => t && setGroupSpreadEnd(t)}
                          className="w-24 bg-slate-900 border-purple-500/30"
                        />
                      </div>

                      <div className="flex items-center gap-1 text-xs">
                        <Button
                          size="small"
                          type="text"
                          className="!text-xs !px-2 !h-7 text-purple-300 hover:text-white"
                          onClick={() => {
                            setGroupSpreadStart(dayjs().startOf('day').add(8, 'hour').add(30, 'minute'));
                            setGroupSpreadEnd(dayjs().startOf('day').add(22, 'hour').add(30, 'minute'));
                          }}
                        >
                          Cả ngày (08:30 - 22:30)
                        </Button>
                        <Button
                          size="small"
                          type="text"
                          className="!text-xs !px-2 !h-7 text-purple-300 hover:text-white"
                          onClick={() => {
                            setGroupSpreadStart(dayjs().add(5, 'minute'));
                            setGroupSpreadEnd(dayjs().add(6, 'hour'));
                          }}
                        >
                          6 tiếng tới
                        </Button>
                      </div>
                    </div>

                    {(() => {
                      const numGroups = Math.max(1, activeSelectedGroupIds.length);
                      const postCount = Math.max(1, validLinkCount || 1);
                      const totalSpanMins = Math.max(30, groupSpreadEnd.diff(groupSpreadStart, 'minute'));
                      const avgGapMins = Math.max(20, Math.floor(totalSpanMins / Math.max(1, postCount)));
                      const hours = Math.floor(avgGapMins / 60);
                      const mins = avgGapMins % 60;
                      const gapText = hours > 0 ? `${hours}h${mins > 0 ? `${mins}p` : ''}` : `${mins} phút`;
                      return (
                        <div className="text-xs text-emerald-300 bg-emerald-950/30 border border-emerald-500/20 px-3 py-2 rounded-lg flex items-center gap-1.5">
                          <CheckCircleOutlined className="text-emerald-400 shrink-0" />
                          <span>
                            Dự kiến: <b>{postCount} bài</b> rải đều cho <b>{numGroups} nhóm</b> từ {groupSpreadStart.format('HH:mm')} đến {groupSpreadEnd.format('HH:mm')}.
                            {numGroups === 1
                              ? ` Mỗi bài cách nhau ~${gapText} (an toàn tuyệt đối cho nhóm).`
                              : ` Trung bình cách ~${gapText}/bài, cùng 1 nhóm đảm bảo tối thiểu 20 phút.`}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="bg-slate-950/70 p-3 rounded-xl border border-purple-500/30 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-xs font-semibold text-purple-200 shrink-0">
                          Giãn cách bài:
                        </span>
                        {[10, 15, 20, 30, 60].map((mins) => {
                          const active = groupStaggerInterval === mins;
                          return (
                            <button
                              key={mins}
                              type="button"
                              onClick={() => setGroupStaggerInterval(mins)}
                              className={`px-2 py-0.5 rounded-lg text-xs font-semibold transition-all border cursor-pointer ${
                                active
                                  ? 'bg-purple-600/30 border-purple-400 text-purple-200 ring-1 ring-purple-500/40 shadow-sm font-bold'
                                  : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-200'
                              }`}
                            >
                              {mins}p {mins === 20 ? '⭐ Khuyên dùng' : ''}
                            </button>
                          );
                        })}
                        <InputNumber
                          min={1}
                          max={1440}
                          value={groupStaggerInterval}
                          onChange={(val) => setGroupStaggerInterval(val || 20)}
                          addonAfter="phút/bài"
                          className="w-28 !text-xs"
                          size="small"
                        />
                      </div>
                    </div>
                    <div className="text-[11px] text-slate-400 italic flex items-center gap-1">
                      <span>💡 Mỗi bài đăng vào Nhóm cách nhau <b>{groupStaggerInterval} phút</b> (khuyên dùng 20p để tránh bị Facebook đánh dấu spam hoặc admin nhóm chặn).</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
