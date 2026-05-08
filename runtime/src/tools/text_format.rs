#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct TextFormatMetadata {
    line_ending: &'static str,
    bom_detected: bool,
}

#[derive(Debug, Default)]
struct LineEndingScan {
    saw_lf: bool,
    saw_crlf: bool,
    saw_cr_only: bool,
    pending_cr: bool,
}

impl LineEndingScan {
    fn push_byte(&mut self, byte: u8) {
        if self.pending_cr {
            if byte == b'\n' {
                self.saw_crlf = true;
                self.pending_cr = false;
                return;
            }
            self.saw_cr_only = true;
            self.pending_cr = false;
        }

        match byte {
            b'\r' => self.pending_cr = true,
            b'\n' => self.saw_lf = true,
            _ => {}
        }
    }

    fn finish(mut self) -> &'static str {
        if self.pending_cr {
            self.saw_cr_only = true;
        }

        let normal_kind_count = usize::from(self.saw_lf) + usize::from(self.saw_crlf);
        if normal_kind_count == 0 && !self.saw_cr_only {
            return "none";
        }
        if normal_kind_count == 1 && !self.saw_cr_only {
            if self.saw_crlf {
                "crlf"
            } else {
                "lf"
            }
        } else {
            "mixed"
        }
    }
}

fn inspect_text_content_format(content: &str) -> TextFormatMetadata {
    let bytes = content.as_bytes();
    let mut scan = LineEndingScan::default();
    for byte in bytes {
        scan.push_byte(*byte);
    }
    TextFormatMetadata {
        line_ending: scan.finish(),
        bom_detected: bytes.starts_with(&[0xEF, 0xBB, 0xBF]),
    }
}

fn inspect_text_file_format(
    target: &Path,
    relative_path: Option<&str>,
) -> Result<TextFormatMetadata, ToolExecutionError> {
    let mut file = fs::File::open(target).map_err(|error| {
        file_io_error(
            format!("failed to read file: {error}"),
            target,
            relative_path,
            "read.text_format",
            "open_format_scan",
            "confirm the text file still exists and is readable, then retry",
        )
    })?;
    let mut scan = LineEndingScan::default();
    let mut prefix = Vec::with_capacity(3);
    let mut buffer = [0_u8; 8192];

    loop {
        let read_bytes = file.read(&mut buffer).map_err(|error| {
            file_io_error(
                format!("failed to read file: {error}"),
                target,
                relative_path,
                "read.text_format",
                "read_format_scan",
                "confirm the text file is readable and stable, then retry",
            )
        })?;
        if read_bytes == 0 {
            break;
        }
        for byte in &buffer[..read_bytes] {
            if prefix.len() < 3 {
                prefix.push(*byte);
            }
            scan.push_byte(*byte);
        }
    }

    Ok(TextFormatMetadata {
        line_ending: scan.finish(),
        bom_detected: prefix == [0xEF, 0xBB, 0xBF],
    })
}
