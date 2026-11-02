import base64,io,json,unittest,zipfile
from radaz_voice import draft,template_text
from radaz_ai import AiError

class Fake:
 def __init__(self,value):self.value=value;self.calls=[]
 def _request(self,path,data):
  self.calls.append(data)
  return {'status':'completed','output':[{'type':'message','content':[{'type':'output_text','text':json.dumps(self.value)}]}]}

class VoiceTemplates(unittest.TestCase):
 def setUp(self):
  self.value={'templateId':'abd','title':'Abdomen','sections':[{'heading':'Öd kisəsi','text':'Divarı 5 mm qalınlaşmışdır. Mənfəzdə 8 mm daş var.'}],'conclusion':'Xolelitiaz.','warnings':['Digər orqanlar barədə diktə yoxdur.']}
  self.payload={'observations':'Öd kisəsi divarı 5 mm, 8 mm daş.','previous':'Öd kisəsi normaldır.','templates':[{'id':'abd','name':'Abdomen','body':'Öd kisəsi: normaldır, daş yoxdur.'}]}
 def test_replace_not_append_and_structured_no_storage(self):
  api=Fake(self.value);r=draft(api,self.payload)
  self.assertNotIn('normaldır',r['text']);self.assertIn('8 mm',r['text']);self.assertEqual(r['templateId'],'abd')
  sent=api.calls[0];self.assertFalse(sent['store']);self.assertTrue(sent['text']['format']['strict'])
  data=json.loads(sent['input'][0]['content'][0]['text']);self.assertEqual(data['previousDraft'],self.payload['previous'])
 def test_selected_template_cannot_change(self):
  p=dict(self.payload,templateId='abd');bad=dict(self.value,templateId='other')
  with self.assertRaises(AiError):draft(Fake(bad),p)
 def test_duplicate_sections_not_persisted(self):
  bad=dict(self.value,sections=self.value['sections']*2)
  with self.assertRaises(AiError):draft(Fake(bad),self.payload)
 def test_unknown_template_input_and_empty_dictation(self):
  with self.assertRaises(AiError):draft(Fake(self.value),dict(self.payload,templateId='missing'))
  with self.assertRaises(AiError):draft(Fake(self.value),dict(self.payload,observations=''))
 def test_incomplete_never_returns_draft(self):
  api=Fake(self.value);api._request=lambda *_:{'status':'incomplete','incomplete_details':{'reason':'content_filter'}}
  with self.assertRaises(AiError):draft(api,self.payload)
 def test_docx_paragraphs_and_tables_without_execution(self):
  xml='<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Öd kisəsi:</w:t></w:r><w:r><w:t> normaldır.</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Qaraciyər</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
  f=io.BytesIO()
  with zipfile.ZipFile(f,'w') as z:z.writestr('word/document.xml',xml)
  self.assertEqual(template_text({'data':base64.b64encode(f.getvalue()).decode()})['text'],'Öd kisəsi: normaldır.\nQaraciyər')
 def test_invalid_or_oversized_docx_is_rejected(self):
  for b in [b'bad',b'']:
   with self.assertRaises(AiError):template_text({'data':base64.b64encode(b).decode()})
  f=io.BytesIO()
  with zipfile.ZipFile(f,'w',zipfile.ZIP_DEFLATED) as z:z.writestr('word/document.xml','x'*1048577)
  with self.assertRaises(AiError):template_text({'data':base64.b64encode(f.getvalue()).decode()})
if __name__=='__main__':unittest.main()
