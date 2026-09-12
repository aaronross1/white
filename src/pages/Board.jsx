import { useParams } from "react-router-dom";
import Whiteboard from "../components/Whiteboard";

export default function Board() {
  const { boardId } = useParams();
  return <Whiteboard boardId={boardId} />;
}
