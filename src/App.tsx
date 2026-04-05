/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  FileText, CheckCircle, AlertTriangle, Star, BookOpen, 
  UserCheck, Send, RefreshCw, FileSearch, ShieldAlert, 
  UploadCloud, Award, PieChart, BarChart, Download, Printer 
} from 'lucide-react';

// Cấu hình API Gemini
const apiKey = process.env.GEMINI_API_KEY;

// Hàm thực hiện gọi API với Exponential Backoff (thử lại khi lỗi)
const fetchWithRetry = async (url: string, options: RequestInit, retries = 5) => {
  const delays = [1000, 2000, 4000, 8000, 16000];
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, delays[i]));
    }
  }
};

// Hàm tải thư viện Mammoth.js động để đọc file .docx
const loadMammoth = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if ((window as any).mammoth) {
      resolve((window as any).mammoth);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.4.21/mammoth.browser.min.js';
    script.onload = () => resolve((window as any).mammoth);
    script.onerror = () => reject(new Error('Không thể tải thư viện đọc file Word.'));
    document.head.appendChild(script);
  });
};

// Hàm tải thư viện PDF.js động để đọc file .pdf
const loadPdfJs = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js';
    script.onload = () => {
      // Thiết lập worker cho PDF.js
      (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
      resolve((window as any).pdfjsLib);
    };
    script.onerror = () => reject(new Error('Không thể tải thư viện đọc file PDF.'));
    document.head.appendChild(script);
  });
};

// Hàm trích xuất text từ file PDF
const extractTextFromPdf = async (arrayBuffer: ArrayBuffer) => {
  const pdfjsLib = await loadPdfJs();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let fullText = '';
  
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n\n';
  }
  
  return fullText;
};

const App = () => {
  const [level, setLevel] = useState('Tiểu học');
  const [content, setContent] = useState('');
  const [evaluationData, setEvaluationData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isFileReading, setIsFileReading] = useState(false);
  const [error, setError] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Prompt hệ thống dựa trên yêu cầu của người dùng
  const systemInstruction = `Bạn là giám khảo cấp tỉnh có hơn 20 năm kinh nghiệm chấm sáng kiến kinh nghiệm từ mầm non, tiểu học, THCS, THPT trong ngành giáo dục.
Hãy đọc tất cả nội dung sáng kiến và TRẢ VỀ KẾT QUẢ ĐỊNH DẠNG JSON với cấu trúc chính xác như sau:
{
  "tenSangKien": "<Tên sáng kiến kinh nghiệm tự động trích xuất từ nội dung>",
  "tenTacGia": "<Tên tác giả tự động trích xuất từ nội dung, nếu không có ghi 'Không xác định'>",
  "tongDiem": <số điểm từ 0-100>,
  "xepLoai": "<Xuất sắc | Tốt | Khá | Đạt | Không đạt>",
  "tyLeTrungLap": "<ví dụ: 15%>",
  "nguyCoDaoVan": "<Thấp | Trung bình | Cao>",
  "nhanXetChung": "<1 đến 2 câu tóm tắt ngắn gọn ưu nhược điểm cốt lõi nhất>",
  "chiTietDanhGia": "<Toàn bộ bài đánh giá chi tiết định dạng bằng Markdown>"
}

Cấu trúc chi tiết cho trường "chiTietDanhGia" PHẢI tuân thủ nghiêm ngặt các phần sau:

====================================================
PHẦN 1. KIỂM TRA ĐẠO VĂN – TRÙNG LẶP
====================================================
1. Kiểm tra tên sáng kiến:
- Tên có trùng hoặc tương tự với sáng kiến đã công bố không?
- Nếu có, nêu: Tên sáng kiến trùng/tương tự, Tác giả (nếu biết), Mức độ giống (% ước lượng)
- Kết luận: Mới / Tương đối / Trùng lặp

2. Kiểm tra nội dung đạo văn:
- Phát hiện các đoạn: Có dấu hiệu sao chép, Văn mẫu, sách vở.
- Với mỗi đoạn: Trích nguyên văn, Nhận định nguồn (nếu có thể), Đánh giá mức độ: Thấp / Trung bình / Cao. (Nếu không chắc nguồn → ghi rõ: "chưa xác định nguồn nhưng có dấu hiệu trùng")

3. Kiểm tra trùng lặp ý tưởng:
- Ý tưởng có phổ biến không? Có phải chỉ là biến thể nhẹ không?
- Nếu có → nêu giải pháp tương tự đã tồn tại

4. Kết luận đạo văn:
- Tỷ lệ trùng lặp tổng thể (% ước lượng)
- Nguy cơ bị đánh trượt: Thấp / Trung bình / Cao

====================================================
PHẦN 2. CHẤM ĐIỂM THEO THANG 100
====================================================
A. NỘI DUNG: 90 ĐIỂM
1. Tính mới (30 điểm): Có phát hiện mới không? Có đột phá không? -> Cho điểm + giải thích chi tiết.
2. Tính khoa học (10 điểm): Luận đề rõ ràng? Luận điểm cụ thể? Luận cứ thực tế? Luận chứng (số liệu, minh chứng)? Tính logic toàn bài? -> Cho điểm chi tiết + nhận xét.
3. Tính ứng dụng (20 điểm): Khả thi không? Áp dụng đại trà không? Phạm vi ảnh hưởng? -> Cho điểm + nhận xét.
4. Tính hiệu quả (30 điểm): Hiệu quả thực tế? Tiết kiệm thời gian/công sức? Lợi ích kinh tế/xã hội? -> Cho điểm + nhận xét.

B. HÌNH THỨC: 10 ĐIỂM
- Bố cục đúng chuẩn? Ngôn ngữ khoa học? Trình bày logic, đẹp? -> Cho điểm + nhận xét.

====================================================
PHẦN 3. XẾP LOẠI & NHẬN XÉT HỘI ĐỒNG
====================================================
1. Tổng điểm: ... /100
2. Xếp loại: 91–100 (Xuất sắc), 81–90 (Tốt), 65–80 (Khá), 50–64 (Đạt), <50 (Không đạt)
3. Phạm vi ảnh hưởng đề xuất: Đơn vị / Ngoài đơn vị / Thành phố (Tỉnh)
4. Nhận xét như giám khảo: Điểm mạnh (cụ thể), Điểm yếu (rõ ràng, không chung chung)
5. Kết luận: Có nên công nhận không? Có nguy cơ bị loại không?

====================================================
PHẦN 4. ĐỀ XUẤT CHỈNH SỬA
====================================================
- Chỉ ra cụ thể: Đoạn cần viết lại, Cách viết lại để tránh đạo văn, Cách tăng tính mới, Cách nâng điểm lên mức cao hơn.

YÊU CẦU QUAN TRỌNG:
- Phân tích sâu, văn phong sắc bén, giống giám khảo thật sự.
- Ưu tiên phát hiện lỗi, bắt bẻ logic và tính thực tế.
- Trình bày kết quả rõ ràng. Dùng ### cho các phần chính trong chiTietDanhGia.`;

  const handleEvaluate = async () => {
    if (!content.trim()) {
      setError('Vui lòng nhập nội dung sáng kiến hoặc tải file lên.');
      return;
    }

    setIsLoading(true);
    setError('');
    setEvaluationData(null);

    const userQuery = `THÔNG TIN SÁNG KIẾN CẦN CHẤM:
- Cấp học: ${level}
- Nội dung chi tiết:
${content}`;

    const payload = {
      contents: [{ parts: [{ text: userQuery }] }],
      systemInstruction: { parts: [{ text: systemInstruction }] },
      generationConfig: { responseMimeType: "application/json" }
    };

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;
      const response = await fetchWithRetry(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response && response.candidates && response.candidates.length > 0) {
        let text = response.candidates[0].content.parts[0].text;
        text = text.replace(/```json\n|\n```/g, '');
        const data = JSON.parse(text);
        setEvaluationData(data);
      } else {
        throw new Error('Đã có lỗi xảy ra khi phân tích dữ liệu.');
      }
    } catch (err) {
      console.error(err);
      setError('Lỗi kết nối hoặc xử lý dữ liệu từ Hệ thống AI. Vui lòng thử lại sau.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsFileReading(true);
    setError('');

    try {
      if (file.name.endsWith('.txt')) {
        const reader = new FileReader();
        reader.onload = (e) => {
          setContent(e.target?.result as string);
          setIsFileReading(false);
        };
        reader.onerror = () => {
          setError('Lỗi khi đọc file .txt');
          setIsFileReading(false);
        };
        reader.readAsText(file);
      } 
      else if (file.name.endsWith('.docx')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const mammoth = await loadMammoth();
            const result = await mammoth.extractRawText({ arrayBuffer: e.target?.result as ArrayBuffer });
            setContent(result.value);
          } catch (err) {
            console.error(err);
            setError('Không thể trích xuất văn bản từ file Word này.');
          } finally {
            setIsFileReading(false);
          }
        };
        reader.onerror = () => {
          setError('Lỗi khi tải file .docx');
          setIsFileReading(false);
        };
        reader.readAsArrayBuffer(file);
      } 
      else if (file.name.endsWith('.pdf')) {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const text = await extractTextFromPdf(e.target?.result as ArrayBuffer);
            setContent(text);
          } catch (err) {
            console.error(err);
            setError('Không thể trích xuất văn bản từ file PDF này. Đảm bảo đây không phải PDF dạng ảnh.');
          } finally {
            setIsFileReading(false);
          }
        };
        reader.onerror = () => {
          setError('Lỗi khi tải file .pdf');
          setIsFileReading(false);
        };
        reader.readAsArrayBuffer(file);
      } else {
        setError('Hệ thống hiện chỉ hỗ trợ định dạng .txt, .docx, và .pdf');
        setIsFileReading(false);
      }
    } catch (err) {
      console.error(err);
      setError('Đã có lỗi xảy ra khi xử lý file.');
      setIsFileReading(false);
    }

    event.target.value = '';
  };

  const fillMockData = () => {
    setLevel('Tiểu học');
    setContent(`Tác giả: Nguyễn Thị Bích Ngọc

I. LÝ DO CHỌN ĐỀ TÀI
Trong trường tiểu học, phân môn Tập đọc có một ý nghĩa to lớn. Đọc trở thành một đòi hỏi cơ bản đầu tiên đối với mỗi người đi học. Đầu tiên trẻ em phải học đọc, sau đó các em phải đọc để học. Đọc giúp các em chiếm lĩnh ngôn ngữ để dùng trong giao tiếp và học tập.
Tuy nhiên thực tế học sinh lớp tôi chủ yếu là con em nông thôn, phụ huynh ít quan tâm, các em đọc còn ngắc ngứ, sai dấu thanh nhiều, đặc biệt là dấu ngã và dấu hỏi.
Vì vậy tôi chọn đề tài: "Một số biện pháp rèn luyện kỹ năng đọc diễn cảm cho học sinh lớp 3".

II. CÁC BIỆN PHÁP THỰC HIỆN
1. Rèn kỹ năng phát âm chuẩn:
Tôi thường xuyên cho các em luyện đọc các từ khó, dễ lẫn như: l/n, ch/tr, s/x. Tôi làm mẫu và yêu cầu học sinh nhìn khẩu hình miệng của cô để phát âm theo.
2. Rèn kỹ năng ngắt nghỉ hơi đúng:
Tôi dùng bút chì gạch chéo (/) vào sách giáo khoa để hướng dẫn học sinh ngắt hơi ở dấu phẩy và nghỉ hơi ở dấu chấm (//).
3. Thi đua đọc diễn cảm:
Mỗi tuần tôi tổ chức "Giọng đọc vàng" để các em thi đua. Em nào đọc tốt sẽ được tặng 1 bông hoa điểm 10.

III. KẾT QUẢ
Sau 1 năm áp dụng, 100% học sinh lớp tôi đã biết đọc, 80% đọc diễn cảm tốt. Không còn học sinh đọc sai lỗi chính tả. Các em tự tin hơn trong giao tiếp.`);
  };

  // Hàm chuyển đổi Markdown cơ bản sang HTML để hiển thị đẹp mắt
  const formatResult = (text: string) => {
    if (!text) return null;
    let formattedText = text
      .replace(/={10,}/g, '<hr class="my-6 border-t-2 border-red-200" />')
      .replace(/PHẦN (\d+)\. (.*?)(?:\n|$)/g, '<h2 class="text-xl font-bold text-red-700 mt-8 mb-4 border-b-2 border-red-500 inline-block pb-1">PHẦN $1. $2</h2><br/>')
      .replace(/### (.*?)(?:\n|$)/g, '<h3 class="text-lg font-semibold text-red-600 mt-4 mb-2">$1</h3>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong class="font-bold text-gray-900">$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em class="italic text-gray-700">$1</em>')
      .replace(/\n\s*-\s/g, '<br/>• ')
      .replace(/\n\s*\+\s/g, '<br/>&nbsp;&nbsp;&nbsp;&nbsp;◦ ')
      .replace(/\n/g, '<br/>');

    return <div className="text-gray-800 leading-relaxed font-roboto" dangerouslySetInnerHTML={{ __html: formattedText }} />;
  };

  // Hàm chuyển đổi Markdown sang HTML tĩnh để nhúng vào file Word
  const formatResultForDoc = (text: string) => {
    if (!text) return '';
    return text
      .replace(/={10,}/g, '<hr style="border-bottom: 2px solid #b91c1c; margin: 20px 0;" />')
      .replace(/PHẦN (\d+)\. (.*?)(?:\n|$)/g, '<h2 style="color: #b91c1c; margin-top: 24px; font-size: 16pt;">PHẦN $1. $2</h2>')
      .replace(/### (.*?)(?:\n|$)/g, '<h3 style="color: #dc2626; margin-top: 16px; font-size: 14pt;">$1</h3>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\n\s*-\s/g, '<br/>• ')
      .replace(/\n\s*\+\s/g, '<br/>&nbsp;&nbsp;&nbsp;&nbsp;◦ ')
      .replace(/\n/g, '<br/>');
  };

  // Hàm tạo và tải file Word
  const handleDownloadWord = () => {
    if (!evaluationData) return;

    // Xử lý tạo tên file an toàn bao gồm tên tác giả
    const safeAuthorName = evaluationData.tenTacGia 
      ? evaluationData.tenTacGia.replace(/[\\/:*?"<>|]/g, '').trim().replace(/\s+/g, '_')
      : 'TacGia_KhongRo';
    const fileName = `Phieu_Cham_SKKN_${safeAuthorName}.doc`;

    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' "+
          "xmlns:w='urn:schemas-microsoft-com:office:word' "+
          "xmlns='http://www.w3.org/TR/REC-html40'>"+
          "<head><meta charset='utf-8'><title>Phiếu Chấm Điểm</title></head><body>";
    const footer = "</body></html>";

    const sourceHTML = `
      <div style="font-family: 'Times New Roman', serif; font-size: 14pt; line-height: 1.5;">
          <h1 style="text-align: center; color: #b91c1c; font-size: 18pt;">PHIẾU ĐÁNH GIÁ SÁNG KIẾN KINH NGHIỆM</h1>
          <p><strong>Tên Sáng Kiến:</strong> ${evaluationData.tenSangKien}</p>
          <p><strong>Tác giả:</strong> ${evaluationData.tenTacGia}</p>
          <table border="1" style="border-collapse: collapse; width: 100%; text-align: left; margin-bottom: 20px;">
              <tr>
                  <th style="padding: 8px; background-color: #f3f4f6;">Tổng điểm</th>
                  <th style="padding: 8px; background-color: #f3f4f6;">Xếp loại</th>
                  <th style="padding: 8px; background-color: #f3f4f6;">Tỷ lệ trùng lặp</th>
                  <th style="padding: 8px; background-color: #f3f4f6;">Nguy cơ bị loại</th>
              </tr>
              <tr>
                  <td style="padding: 8px; font-weight: bold; color: #b91c1c; text-align: center;">${evaluationData.tongDiem}/100</td>
                  <td style="padding: 8px; font-weight: bold; text-align: center;">${evaluationData.xepLoai}</td>
                  <td style="padding: 8px; font-weight: bold; text-align: center;">${evaluationData.tyLeTrungLap}</td>
                  <td style="padding: 8px; font-weight: bold; text-align: center;">${evaluationData.nguyCoDaoVan}</td>
              </tr>
          </table>
          <p style="background-color: #f9fafb; padding: 10px; border-left: 4px solid #d1d5db;">
            <strong>Nhận xét chung:</strong> <em>${evaluationData.nhanXetChung}</em>
          </p>
          <br/>
          ${formatResultForDoc(evaluationData.chiTietDanhGia)}
          <br/>
          <table style="width: 100%; border: none; margin-top: 40px;">
              <tr>
                  <td style="width: 50%;"></td>
                  <td style="width: 50%; text-align: center;">
                      <p><em>Ngày ..... tháng ..... năm 20...</em></p>
                      <p><strong>GIÁM KHẢO THẨM ĐỊNH</strong></p>
                      <br/><br/><br/><br/>
                      <p><strong>(Hệ thống AI)</strong></p>
                  </td>
              </tr>
          </table>
      </div>
    `;

    const source = header + sourceHTML + footer;
    const blob = new Blob(['\ufeff', source], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="min-h-screen bg-gray-50 font-roboto" style={{ fontFamily: "'Roboto', sans-serif" }}>
      {/* Header - Ẩn khi in */}
      <header className="bg-gradient-to-r from-red-800 to-red-600 text-white shadow-lg print:hidden">
        <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 flex items-center gap-4">
          <div className="bg-yellow-400 p-3 rounded-full shadow-inner">
            <UserCheck className="w-8 h-8 text-red-900" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-yellow-50 uppercase drop-shadow-md">Hệ Thống AI Chấm Sáng Kiến Kinh Nghiệm</h1>
            <p className="text-red-100 text-sm mt-1">Góc nhìn chuyên sâu từ Giám khảo Cấp tỉnh - Hơn 20 năm kinh nghiệm</p>
          </div>
        </div>
      </header>

      {/* Main Container - Tối ưu khi in */}
      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 print:p-0 print:m-0">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 print:block">
          
          {/* Left Column: Input Form - Ẩn khi in */}
          <div className="lg:col-span-5 space-y-6 print:hidden">
            <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
              <div className="bg-gray-100 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <FileText className="w-5 h-5 text-red-600" />
                  Hồ sơ Sáng kiến
                </h2>
                <button 
                  onClick={fillMockData}
                  className="text-xs text-red-600 hover:text-red-800 font-medium bg-red-50 px-3 py-1 rounded-full border border-red-100 transition-colors"
                >
                  Dữ liệu mẫu
                </button>
              </div>
              
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Cấp học</label>
                  <select 
                    value={level}
                    onChange={(e) => setLevel(e.target.value)}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 bg-white border p-2.5 text-gray-700"
                  >
                    <option value="Mầm non">Mầm non</option>
                    <option value="Tiểu học">Tiểu học</option>
                    <option value="THCS">Trung học Cơ sở (THCS)</option>
                    <option value="THPT">Trung học Phổ thông (THPT)</option>
                    <option value="GDTX">Giáo dục Thường xuyên</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="block text-sm font-medium text-gray-700">Nội dung tóm tắt / Toàn văn</label>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleFileUpload}
                      accept=".txt,.docx,.pdf"
                      className="hidden"
                    />
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isFileReading || isLoading}
                      type="button"
                      className="text-xs flex items-center gap-1.5 text-blue-700 hover:text-blue-900 font-medium bg-blue-50 px-3 py-1.5 rounded border border-blue-200 transition-colors disabled:opacity-50"
                    >
                      {isFileReading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
                      {isFileReading ? 'Đang trích xuất...' : 'Tải file lên (.txt, .docx, .pdf)'}
                    </button>
                  </div>
                  
                  <textarea 
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    rows={15}
                    disabled={isFileReading}
                    placeholder="Dán toàn bộ nội dung sáng kiến kinh nghiệm vào đây hoặc nhấn tải file lên..."
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 border p-3 text-gray-700 text-sm leading-relaxed disabled:bg-gray-50"
                  />
                  <p className="text-xs text-gray-500 mt-2">Hỗ trợ trích xuất văn bản tự động từ file Word (.docx), PDF (.pdf) và file Text (.txt).</p>
                </div>

                {error && (
                  <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm border border-red-200 flex gap-2 items-start">
                    <ShieldAlert className="w-5 h-5 flex-shrink-0" />
                    {error}
                  </div>
                )}

                <button 
                  onClick={handleEvaluate}
                  disabled={isLoading || isFileReading}
                  className={`w-full flex items-center justify-center gap-2 py-3 px-4 border border-transparent rounded-md shadow-sm text-base font-medium text-white transition-all
                    ${(isLoading || isFileReading)
                      ? 'bg-red-400 cursor-not-allowed' 
                      : 'bg-red-700 hover:bg-red-800 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500'}`}
                >
                  {isLoading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Giám khảo đang phân tích...
                    </>
                  ) : (
                    <>
                      <FileSearch className="w-5 h-5" />
                      Tiến hành Chấm điểm & Đánh giá
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Output/Results - Tối ưu hiển thị cho PDF/Print */}
          <div className="lg:col-span-7 print:w-full print:block">
            <div className="bg-white rounded-xl shadow-md border border-gray-200 h-full flex flex-col print:shadow-none print:border-none print:m-0 print:p-0">
              
              {/* Tiêu đề Kết quả và Các nút hành động */}
              <div className="bg-yellow-50 px-6 py-4 border-b border-yellow-200 flex justify-between items-center rounded-t-xl print:hidden">
                <h2 className="text-lg font-bold text-yellow-800 flex items-center gap-2">
                  <Star className="w-5 h-5 text-yellow-600 fill-current" />
                  Kết Quả Thẩm Định Của Hội Đồng
                </h2>
                
                {/* Nút In ấn và Tải Word (Chỉ hiện khi có kết quả) */}
                {evaluationData && !isLoading && (
                  <div className="flex gap-2">
                    <button 
                      onClick={() => window.print()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 rounded text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors shadow-sm"
                    >
                      <Printer className="w-4 h-4" /> <span className="hidden sm:inline">In PDF</span>
                    </button>
                    <button 
                      onClick={handleDownloadWord}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 border border-transparent rounded text-sm font-medium text-white hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      <Download className="w-4 h-4" /> <span className="hidden sm:inline">Tải File Word</span>
                    </button>
                  </div>
                )}
              </div>
              
              <div className="p-8 flex-1 overflow-auto bg-[url('https://www.transparenttextures.com/patterns/cream-paper.png')] bg-repeat flex flex-col gap-8 print:p-0 print:bg-none print:block print:overflow-visible">
                {!evaluationData && !isLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-60 m-auto print:hidden">
                    <BookOpen className="w-24 h-24 mb-4 text-gray-300" />
                    <p className="text-lg text-center">Bảng đánh giá sẽ xuất hiện tại đây<br/>sau khi bạn gửi hồ sơ sáng kiến.</p>
                  </div>
                )}

                {isLoading && (
                  <div className="h-full flex flex-col items-center justify-center text-red-600 m-auto print:hidden">
                    <div className="animate-pulse flex flex-col items-center">
                      <FileSearch className="w-16 h-16 mb-4" />
                      <p className="text-lg font-medium">Đang quét đạo văn & phân tích chuyên môn...</p>
                      <p className="text-sm text-gray-500 mt-2">Việc này có thể mất vài giây. Vui lòng chờ.</p>
                    </div>
                  </div>
                )}

                {evaluationData && !isLoading && (
                  <>
                    {/* Mục Bảng Tổng Hợp */}
                    <div className="bg-white p-6 rounded-xl border-2 border-red-100 shadow-sm relative overflow-hidden print:border print:shadow-none print:break-inside-avoid">
                      <div className="absolute top-0 right-0 bg-red-600 text-white text-xs font-bold px-3 py-1 rounded-bl-lg print:border print:border-red-600 print:text-red-700 print:bg-white">BẢNG TÓM TẮT</div>
                      <h3 className="text-lg font-bold text-red-800 mb-4 pb-2 flex items-center gap-2">
                        <BarChart className="w-6 h-6 text-red-600" />
                        Tổng Hợp Kết Quả Đánh Giá
                      </h3>

                      <div className="mb-6 pb-5 border-b border-gray-100">
                        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Tên Sáng Kiến Kinh Nghiệm:</h4>
                        <p className="text-base font-bold text-blue-900 leading-snug mb-3">{evaluationData.tenSangKien}</p>
                        <h4 className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-1">Tác Giả:</h4>
                        <p className="text-sm font-semibold text-gray-800">{evaluationData.tenTacGia}</p>
                      </div>
                      
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                        <div className="bg-red-50 rounded-lg p-4 flex flex-col items-center justify-center text-center border border-red-100 shadow-sm print:bg-white print:border-gray-300">
                          <span className="text-sm text-gray-600 font-medium mb-2">Tổng điểm</span>
                          <div className="flex items-baseline gap-1">
                            <span className="text-4xl font-black text-red-700">{evaluationData.tongDiem}</span>
                            <span className="text-sm text-gray-500 font-bold">/100</span>
                          </div>
                        </div>
                        
                        <div className="bg-yellow-50 rounded-lg p-4 flex flex-col items-center justify-center text-center border border-yellow-100 shadow-sm print:bg-white print:border-gray-300">
                          <span className="text-sm text-gray-600 font-medium mb-1">Xếp loại</span>
                          <Award className={`w-8 h-8 mb-1 ${['Xuất sắc', 'Tốt'].includes(evaluationData.xepLoai) ? 'text-yellow-600' : 'text-gray-400'}`} />
                          <span className="text-lg font-bold text-gray-800 uppercase">{evaluationData.xepLoai}</span>
                        </div>

                        <div className="bg-blue-50 rounded-lg p-4 flex flex-col items-center justify-center text-center border border-blue-100 shadow-sm print:bg-white print:border-gray-300">
                          <span className="text-sm text-gray-600 font-medium mb-1">Trùng lặp</span>
                          <PieChart className="w-8 h-8 mb-1 text-blue-600" />
                          <span className="text-lg font-bold text-gray-800">{evaluationData.tyLeTrungLap}</span>
                        </div>

                        <div className={`rounded-lg p-4 flex flex-col items-center justify-center text-center border shadow-sm print:bg-white print:border-gray-300 ${evaluationData.nguyCoDaoVan === 'Thấp' ? 'bg-green-50 border-green-100 text-green-700' : evaluationData.nguyCoDaoVan === 'Trung bình' ? 'bg-orange-50 border-orange-100 text-orange-700' : 'bg-red-100 border-red-200 text-red-700'}`}>
                          <span className="text-sm font-medium mb-1 opacity-90">Nguy cơ bị loại</span>
                          <ShieldAlert className="w-8 h-8 mb-1" />
                          <span className="text-lg font-bold uppercase">{evaluationData.nguyCoDaoVan}</span>
                        </div>
                      </div>

                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-gray-700 text-sm italic relative print:bg-white">
                        <span className="absolute -top-3 left-4 bg-gray-50 px-2 text-xs font-bold text-gray-500 uppercase tracking-wider print:bg-white">Nhận xét chung của Giám khảo</span>
                        "{evaluationData.nhanXetChung}"
                      </div>
                    </div>

                    {/* Chi tiết đánh giá */}
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm print:border-none print:shadow-none print:p-0">
                      <h3 className="text-lg font-bold text-gray-800 mb-6 border-b border-gray-200 pb-2 flex items-center gap-2">
                        <FileText className="w-5 h-5 text-gray-500" />
                        Báo Cáo Thẩm Định Chi Tiết
                      </h3>
                      <div className="prose prose-red max-w-none text-justify">
                        <div className="float-right border-4 border-red-700 text-red-700 p-2 transform rotate-12 opacity-80 rounded-sm mb-4 ml-4 print:hidden">
                          <div className="border border-red-700 p-1 text-center font-bold tracking-widest uppercase text-sm">
                            ĐÃ THẨM ĐỊNH<br/>
                            <span className="text-xs">HỘI ĐỒNG AI</span>
                          </div>
                        </div>
                        {formatResult(evaluationData.chiTietDanhGia)}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;
