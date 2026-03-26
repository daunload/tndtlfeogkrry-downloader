use std::fs::File;
use std::io::Write;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

/// MP4 파일에서 AAC 오디오 트랙을 추출하여 ADTS 헤더를 붙인 m4a/aac 파일로 저장한다.
pub fn extract_aac(mp4_path: &str, m4a_path: &str) -> Result<(), String> {
    let file = File::open(mp4_path).map_err(|e| format!("MP4 파일 열기 실패: {}", e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    hint.with_extension("mp4");

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("MP4 파싱 실패: {}", e))?;

    let mut format_reader = probed.format;

    // Find AAC track
    let audio_track = format_reader
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec == symphonia::core::codecs::CODEC_TYPE_AAC)
        .ok_or("AAC 오디오 트랙을 찾을 수 없습니다")?;

    let track_id = audio_track.id;
    let sample_rate = audio_track.codec_params.sample_rate.unwrap_or(44100);
    let channels = audio_track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(2) as u8;

    let sample_rate_index: u8 = match sample_rate {
        96000 => 0,
        88200 => 1,
        64000 => 2,
        48000 => 3,
        44100 => 4,
        32000 => 5,
        24000 => 6,
        22050 => 7,
        16000 => 8,
        12000 => 9,
        11025 => 10,
        8000 => 11,
        _ => 4, // default to 44100
    };

    let mut output = File::create(m4a_path).map_err(|e| format!("출력 파일 생성 실패: {}", e))?;

    loop {
        match format_reader.next_packet() {
            Ok(packet) => {
                if packet.track_id() != track_id {
                    continue;
                }
                let data = packet.buf();
                let frame_len = data.len() + 7;

                let mut header = [0u8; 7];
                header[0] = 0xFF;
                header[1] = 0xF1;
                header[2] =
                    (1 << 6) | (sample_rate_index << 2) | ((channels >> 2) & 0x01);
                header[3] =
                    ((channels & 0x03) << 6) | ((frame_len >> 11) as u8 & 0x03);
                header[4] = ((frame_len >> 3) as u8) & 0xFF;
                header[5] = (((frame_len & 0x07) as u8) << 5) | 0x1F;
                header[6] = 0xFC;

                output
                    .write_all(&header)
                    .map_err(|e| format!("ADTS 헤더 쓰기 실패: {}", e))?;
                output
                    .write_all(data)
                    .map_err(|e| format!("AAC 데이터 쓰기 실패: {}", e))?;
            }
            Err(symphonia::core::errors::Error::IoError(e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(e) => {
                return Err(format!("패킷 읽기 실패: {}", e));
            }
        }
    }

    output
        .flush()
        .map_err(|e| format!("파일 플러시 실패: {}", e))?;
    Ok(())
}
