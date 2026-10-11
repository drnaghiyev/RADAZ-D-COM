'use client';
import {useTranslation as useUiTranslation,translate as tr} from '@/lib/i18n';
import {RadazLogo} from '@/components/radaz-logo';
import {AppHelpMenu} from '@/components/app-product';
export default function ChatGPTHelp(){
  useUiTranslation();return <main className="chatgpt-help-page"><header><RadazLogo size={55}/><div><small>RADAZ</small><h1>{tr('ui.zip_transfer_to_chatgpt_42994')}</h1></div><AppHelpMenu/></header>
<p>{tr('ui.extension_0_3_3_places_only_radaz_chatgpt_zip_af7bf')}</p>
<ol><li><a href="/radaz-chatgpt-extension.zip" download>{tr('ui.radaz_chatgpt_extension_0_3_3_0fb83')}</a> {tr('ui.download_the_zip_and_extract_it_to_a_separate_39371')}</li><li>{tr('ui.in_chrome_open_9d632')}<code>chrome://extensions</code>{tr('ui._in_edge_open_bc9ca')}<code>edge://extensions</code> {tr('ui._choose_the_folder_using_developer_mode_load_376da')}</li><li>{tr('ui.enter_the_radaz_address_in_the_extension_for_1807c')}<code>http://localhost:5173</code>{tr('ui._refresh_the_radaz_and_chatgpt_pages_4e7f3')}</li><li>{tr('ui.open_a_study_in_the_viewer_and_press_report_s_a1976')}</li><li>{tr('ui.press_transfer_zip_to_chatgpt_one_zip_is_atta_43218')}</li><li>{tr('ui.check_the_zip_upload_in_chatgpt_and_send_the_4a4d7')}</li><li>{tr('ui.when_ready_press_return_to_radaz_review_the_r_e34cb')}</li></ol>
<h2>{tr('ui.without_the_extension_ae330')}</h2><p>{tr('ui.download_the_zip_and_attach_it_in_chatgpt_cop_3dd3d')}</p>
<h2>{tr('ui.if_the_zip_cannot_be_opened_208fd')}</h2><p>{tr('ui.a_filename_or_instruction_text_does_not_prove_c17b0')}</p>
<p>{tr('ui.the_local_zip_limit_is_480_mb_the_preview_sho_27ce9')}</p><a href="/report">{tr('ui.return_to_report_c2f9c')}</a></main>}
