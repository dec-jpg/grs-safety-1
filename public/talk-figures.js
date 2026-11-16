// ============================================================
//  Toolbox talk illustrations.
//  A section in src/talks/library.json can carry "figure": "<key>".
//  talk.html draws the matching illustration under the section text.
//  Plain inline SVG so the talk needs no image files and works on
//  a poor signal. Add a new drawing here, then reference its key.
// ============================================================
(function () {
  var F = 'font-family="DM Sans,Arial,sans-serif" font-weight="800"';
  var open = function (label) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 250" role="img" aria-label="' + label + '">' +
      '<rect width="400" height="250" fill="#f6f5f2"/>';
  };
  var tick = '<circle cx="28" cy="28" r="16" fill="#2f7d4f"/><path d="M20 28l6 6 11-13" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<text x="52" y="33" font-size="14" fill="#2f7d4f" ' + F + '>CORRECT</text>';
  var cross = '<circle cx="28" cy="28" r="16" fill="#B3261E"/><path d="M21 21l14 14M35 21l-14 14" stroke="#fff" stroke-width="4" stroke-linecap="round"/>' +
    '<text x="52" y="33" font-size="14" fill="#B3261E" ' + F + '>NEVER</text>';

  // A standing operative, side view. x = centre, y = ground level.
  var person = function (x, y) {
    return '<line x1="' + (x - 6) + '" y1="' + (y - 40) + '" x2="' + (x - 6) + '" y2="' + (y - 3) + '" stroke="#3a3630" stroke-width="7" stroke-linecap="round"/>' +
      '<line x1="' + (x + 6) + '" y1="' + (y - 40) + '" x2="' + (x + 6) + '" y2="' + (y - 3) + '" stroke="#3a3630" stroke-width="7" stroke-linecap="round"/>' +
      '<rect x="' + (x - 11) + '" y="' + (y - 84) + '" width="22" height="48" rx="7" fill="#F2C200"/>' +
      '<rect x="' + (x - 11) + '" y="' + (y - 66) + '" width="22" height="4" fill="#fff"/>' +
      '<rect x="' + (x - 11) + '" y="' + (y - 54) + '" width="22" height="4" fill="#fff"/>' +
      '<circle cx="' + x + '" cy="' + (y - 95) + '" r="9" fill="#e3b08a"/>' +
      '<path d="M' + (x - 11) + ' ' + (y - 96) + 'a11 11 0 0 1 22 0z" fill="#fff" stroke="#3a3630" stroke-width="1.5"/>';
  };

  var FIG = {};

  // 1. Correct: the kerb lifter takes the weight, the operative guides from the side.
  FIG['kerb-lifter'] = {
    caption: 'The kerb lifter takes the weight. The operative guides the kerb by the handle from the side, with hands and feet clear, and the kerb is lowered onto the bed.',
    svg: open('A mechanical kerb lifter lowering a kerb into place while the operative guides it from the side') +
      '<rect x="0" y="200" width="400" height="50" fill="#d9d2c4"/>' +
      '<rect x="0" y="192" width="400" height="8" fill="#b9b1a2"/>' +
      [16, 78, 140].map(function (x) { return '<rect x="' + x + '" y="158" width="60" height="34" fill="#9d978d" stroke="#6f685d" stroke-width="1.5"/>'; }).join('') +
      '<line x1="232" y1="68" x2="400" y2="22" stroke="#F2A900" stroke-width="15" stroke-linecap="round"/>' +
      '<line x1="232" y1="72" x2="232" y2="122" stroke="#3a3630" stroke-width="3" stroke-dasharray="5 3"/>' +
      '<rect x="208" y="122" width="48" height="13" rx="3" fill="#EC4B32"/>' +
      '<rect x="198" y="128" width="7" height="30" rx="2" fill="#EC4B32"/><rect x="259" y="128" width="7" height="30" rx="2" fill="#EC4B32"/>' +
      '<rect x="202" y="137" width="60" height="34" fill="#9d978d" stroke="#6f685d" stroke-width="1.5"/>' +
      '<path d="M232 175v11m-5-5l5 6 5-6" fill="none" stroke="#2f7d4f" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<line x1="256" y1="128" x2="313" y2="121" stroke="#3a3630" stroke-width="4" stroke-linecap="round"/>' +
      person(332, 192) +
      '<line x1="325" y1="116" x2="311" y2="121" stroke="#F2C200" stroke-width="6" stroke-linecap="round"/>' +
      '<text x="20" y="118" font-size="12.5" fill="#1f1c17" ' + F + '>Lifter takes the weight</text>' +
      '<line x1="170" y1="121" x2="204" y2="127" stroke="#1f1c17" stroke-width="1.5"/>' +
      '<text x="332" y="228" font-size="12.5" fill="#1f1c17" text-anchor="middle" ' + F + '>Hands and feet clear</text>' +
      '<text x="330" y="52" font-size="11.5" fill="#6f685d" text-anchor="middle" ' + F + '>Machine arm</text>' +
      tick + '</svg>'
  };

  // 2. Correct: plan view of an exclusion zone with pedestrians kept outside it.
  FIG['exclusion-zone'] = {
    caption: 'Seen from above. Everyone on foot stays outside the exclusion zone and behind the barrier. The banksman stands outside the zone, where the operator can see them.',
    svg: open('Plan view of an excavator inside a marked exclusion zone, with pedestrians on a separate route behind a barrier') +
      '<rect x="306" y="14" width="80" height="222" rx="6" fill="#e9f4ee" stroke="#2f7d4f" stroke-width="1.5"/>' +
      '<text transform="translate(377 125) rotate(-90)" font-size="11.5" fill="#2f7d4f" text-anchor="middle" ' + F + '>PEDESTRIAN ROUTE</text>' +
      '<line x1="292" y1="14" x2="292" y2="236" stroke="#fff" stroke-width="7"/>' +
      '<line x1="292" y1="14" x2="292" y2="236" stroke="#B3261E" stroke-width="7" stroke-dasharray="11 11"/>' +
      '<circle cx="160" cy="128" r="98" fill="#B3261E" fill-opacity=".1" stroke="#B3261E" stroke-width="2.5" stroke-dasharray="8 6"/>' +
      '<rect x="131" y="98" width="13" height="62" rx="3" fill="#3a3630"/><rect x="176" y="98" width="13" height="62" rx="3" fill="#3a3630"/>' +
      '<line x1="168" y1="120" x2="222" y2="80" stroke="#F2A900" stroke-width="10" stroke-linecap="round"/>' +
      '<path d="M216 70l16 4-4 16-12-2z" fill="#3a3630"/>' +
      '<rect x="140" y="105" width="40" height="46" rx="6" fill="#F2A900" stroke="#3a3630" stroke-width="1.5"/>' +
      '<rect x="144" y="110" width="14" height="18" rx="2" fill="#cfe3ee" stroke="#3a3630" stroke-width="1"/>' +
      '<text x="160" y="207" font-size="12.5" fill="#B3261E" text-anchor="middle" ' + F + '>EXCLUSION ZONE</text>' +
      '<line x1="158" y1="121" x2="264" y2="209" stroke="#2f7d4f" stroke-width="1.5" stroke-dasharray="3 4"/>' +
      '<circle cx="271" cy="215" r="10" fill="#EC4B32" stroke="#3a3630" stroke-width="1.5"/><circle cx="271" cy="215" r="4.5" fill="#fff"/>' +
      '<text x="256" y="240" font-size="11.5" fill="#1f1c17" text-anchor="end" ' + F + '>Banksman</text>' +
      [78, 160].map(function (y) { return '<circle cx="336" cy="' + y + '" r="10" fill="#F2C200" stroke="#3a3630" stroke-width="1.5"/><circle cx="336" cy="' + y + '" r="4.5" fill="#fff"/>'; }).join('') +
      tick + '</svg>'
  };

  // 3. Prohibited: nobody beneath a raised bucket.
  FIG['under-bucket'] = {
    caption: 'Prohibited. Nobody stands, walks or works beneath a raised bucket, an attachment or a suspended load.',
    svg: open('A person standing beneath a raised excavator bucket, crossed out as prohibited') +
      '<rect x="0" y="205" width="400" height="45" fill="#d9d2c4"/>' +
      '<rect x="24" y="180" width="118" height="25" rx="12" fill="#3a3630"/>' +
      '<rect x="40" y="142" width="86" height="40" rx="5" fill="#F2A900" stroke="#3a3630" stroke-width="1.5"/>' +
      '<rect x="86" y="110" width="40" height="34" rx="4" fill="#F2A900" stroke="#3a3630" stroke-width="1.5"/>' +
      '<rect x="92" y="116" width="28" height="19" rx="2" fill="#cfe3ee" stroke="#3a3630" stroke-width="1"/>' +
      '<polyline points="112,146 180,34 262,50" fill="none" stroke="#F2A900" stroke-width="13" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M250 48h30l7 24-24 10-16-16z" fill="#3a3630"/>' +
      person(268, 203).replace(/#F2C200/g, '#c9c2b4') +
      '<circle cx="268" cy="140" r="62" fill="none" stroke="#B3261E" stroke-width="9"/>' +
      '<line x1="224" y1="96" x2="312" y2="184" stroke="#B3261E" stroke-width="9"/>' +
      '<text x="200" y="237" font-size="14" fill="#B3261E" text-anchor="middle" ' + F + '>NEVER BENEATH THE BUCKET</text>' +
      cross + '</svg>'
  };

  window.__TBT_FIGURES__ = FIG;
})();
