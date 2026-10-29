/**
 * Google Apps Script - Web App Backend สำหรับบูธกิจกรรมสุขภาพ
 * ระบบเชื่อมต่อ Google Sheets: ดึงข้อมูลพนักงานอัตโนมัติ & บันทึกผลคะแนน
 *
 * โครงสร้างแท็บใน Google Spreadsheet:
 * 1. แท็บ "Name" หรือ "พนักงาน":
 *    - คอลัมน์ A: รหัสพนักงาน
 *    - คอลัมน์ B: ชื่อ-นามสกุล
 *    - คอลัมน์ C: แผนก
 * 
 * 2. แท็บ "ผลการแข่งขัน":
 *    - บันทึกประวัติการเล่นเกม คะแนน อันดับ และผู้ได้รับรางวัลอัตโนมัติ
 */

function doGet(e) {
  var action = e.parameter ? e.parameter.action : '';
  
  if (action === 'getEmployees') {
    return getEmployeesData();
  }
  
  return responseJSON({
    status: 'success',
    message: 'Health Booth Game API is running successfully'
  });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName("ผลการแข่งขัน");
    
    // ถ้ายังไม่มีแท็บ "ผลการแข่งขัน" ให้สร้างให้อัตโนมัติพร้อมหัวตาราง
    if (!sheet) {
      sheet = ss.insertSheet("ผลการแข่งขัน");
      sheet.appendRow([
        "วัน-เวลาที่เล่น",
        "รหัสพนักงาน",
        "ชื่อ-นามสกุล",
        "แผนก",
        "เกมที่เล่น",
        "คะแนนที่ได้",
        "อันดับที่ได้",
        "จำนวนผู้เล่นในรอบ",
        "สถานะรางวัล"
      ]);
      sheet.getRange("A1:I1").setFontWeight("bold").setBackground("#059669").setFontColor("#ffffff");
      sheet.setFrozenRows(1);
    }

    var now = new Date();
    var cleanId = String(data.empId || '').replace(/^'/, '').trim();
    var empIdStr = "'" + cleanId;
    var isWinner = data.isWinner ? "ได้รับรางวัล 🎁" : "-";

    sheet.appendRow([
      now,
      empIdStr,
      data.fullName || data.name || '',
      data.department || '',
      data.gameName || '',
      data.score || 0,
      data.rank || '-',
      data.totalPlayers || 1,
      isWinner
    ]);

    var lastRow = sheet.getLastRow();
    // บังคับให้คอลัมน์รหัสพนักงานเป็นข้อความ Text (@) ป้องกันเลข 0 หาย
    sheet.getRange(lastRow, 2).setNumberFormat("@");
    
    // ไฮไลท์แถวผู้ชนะเป็นสีเขียวอ่อน
    if (data.isWinner) {
      sheet.getRange(lastRow, 9).setBackground("#d1fae5").setFontColor("#065f46").setFontWeight("bold");
    }

    return responseJSON({
      status: 'success',
      message: 'บันทึกคะแนนลง Google Sheet เรียบร้อยแล้ว'
    });
  } catch (error) {
    return responseJSON({
      status: 'error',
      message: error.toString()
    });
  }
}

// ฟังก์ชันดึงรายชื่อพนักงานจากแท็บ "Name" หรือแท็บแรก
function getEmployeesData() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Name") || ss.getSheetByName("พนักงาน") || ss.getSheets()[0];
  var data = sheet.getDataRange().getValues();
  var employees = [];
  
  for (var i = 1; i < data.length; i++) {
    var rawId = String(data[i][0] || '').replace(/^'/, '').trim();
    var fullName = String(data[i][1] || '').trim();
    var department = String(data[i][2] || '').trim();
    
    if (rawId || fullName) {
      var empId = rawId;
      // จัดรูปแบบรหัสพนักงานให้มี 6 หลัก (เติม 0 ข้างหน้าถ้าเป็นตัวเลขสั้น)
      if (/^\d+$/.test(empId) && empId.length < 6) {
        empId = ("000000" + empId).slice(-6);
      }

      employees.push({
        empId: empId,
        rawId: rawId,
        fullName: fullName,
        department: department
      });
    }
  }
  
  return responseJSON({
    status: 'success',
    total: employees.length,
    employees: employees
  });
}

function responseJSON(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
